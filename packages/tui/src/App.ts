// src/tui/App.ts
// Root Component of the pi-tui TUI. Owns the AppStore, wires
// dispatch → tui.requestRender(), and lays out Header + chat
// viewport + (optional) plan/todo overlays + StatusBar.
//
// M2 surface (this file): renders the chat viewport from state.items,
// subscribes to agent events and plan events, ticks the status stats
// poll, installs the permission gate. No focusable input yet — that
// comes in M3 (interactive cards) and M4 (Editor + entry swap).

import { readFileSync } from "node:fs";
import { Container, type TUI, type Component } from "./vendor/pi-tui/tui.js";
import { Header, type HeaderStats } from "./components/base/Header.js";
import { StatusBar } from "./components/base/StatusBar.js";
import { ChatViewport } from "./components/chat/ChatViewport.js";
import { PlanPanel } from "./components/agent/PlanPanel.js";
import { ResumePrompt } from "./components/agent/ResumePrompt.js";
import { TodoPill } from "./components/todo/TodoPill.js";
import { PermissionPanel } from "./components/permission/PermissionPanel.js";
import { CommandPalette } from "./components/command-components/CommandPalette.js";
import { SessionsPanel } from "./components/session-components/SessionsPanel.js";
import { InputBox } from "./components/input/InputBox.js";
import {
	HEADER_ROWS,
	STATUS_ROWS,
	INPUT_ROWS,
	MIN_CHAT_HEIGHT,
	MAX_ITEM_ROWS,
	STATS_TICK_MS,
	PLAN_ROWS_COLLAPSED,
	PLAN_ROWS_EXPANDED,
	TODO_ROWS,
	PERMISSION_ROWS,
	DANGEROUS_TOOLS,
} from "./constants.js";
import { createAppStore, type AppStore } from "./runtime/app-state.js";
import { SisyphusAnimator } from "./runtime/sisyphus.js";
import { eventToAction } from "./transform/events.js";
import { planEventToAction, type PlanRef } from "./transform/plan-events.js";
import { compactEventToAction } from "./transform/compact-events.js";
import { describeMemoryAction, buildMemoryPreview } from "./transform/memory.js";
import { describeFileWrite, buildFileWritePreview } from "./transform/file-write.js";
// import { parseMemoryAction } from "@phus/runtime/infra/meta/index.js";
import { runSlash, SLASH_COMMANDS } from "./handler/commands/commands.js";
import { buildShortcutListener, type GlobalShortcutCallbacks } from "./runtime/keybindings.js";
import { submitMessage } from "./handler/submit-message.js";
import { tuiChannel } from "./channel.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppState, PermissionRequest } from "./state/state.js";
import { parseMemoryAction } from "@phus/runtime/infra/meta/memory-tools.js";

export interface AppDeps {
	readonly agent: PhusAgent;
	readonly sessionId: string;
	readonly modelLabel: string;
	/** Fired when state.quitRequested appears (/quit, /exit, idle Ctrl+C). */
	readonly onQuit?: () => void;
}

interface FileSnapshot {
	path: string;
	content: string;
}

/** How long to show the plan panel after a terminal status before auto-dismissing. */
const PLAN_DISMISS_DELAY_MS = 5_000;

export class App extends Container {
	private replaceChildByRef(old: Component, next: Component): void {
		const idx = this.children.indexOf(old);
		if (idx < 0) {
			this.addChild(next);
			return;
		}
		this.children.splice(idx, 1, next);
		this.invalidate();
	}

	private readonly store: AppStore;
	private readonly agent: PhusAgent;
	private readonly sessionId: string;
	private readonly modelLabel: string;
	private tui: TUI | undefined;
	private readonly header: Header;
	private readonly statusBar: StatusBar;
	private readonly viewport: ChatViewport;
	private readonly fileSnapshots = new Map<string, FileSnapshot>();
	private readonly animator = new SisyphusAnimator();
	private headerStats: HeaderStats = emptyStats();
	private lastOp = "idle";
	private wasBusy = false;
	private terminalRows = 24;
	private terminalCols = 80;
	private statsInterval: ReturnType<typeof setInterval> | undefined;
	private agentUnsub: (() => void) | undefined;
	private planUnsub: (() => void) | undefined;
	private compactUnsub: (() => void) | undefined;
	private readonly planRef: PlanRef = { current: undefined };
	private viewportHeight = MIN_CHAT_HEIGHT;
	private prevViewportHeight = MIN_CHAT_HEIGHT;
	private todoChild: TodoPill;
	private planChild?: PlanPanel;
	private permissionChild?: PermissionPanel;
	private paletteChild?: CommandPalette;
	private sidebarChild?: SessionsPanel;
	private resumeChild?: ResumePrompt;
	private inputBox!: InputBox;
	private sidebarOpen = false;
	private paletteOpen = false;
	private planExpanded = false;
	private inputListenerUnsub: (() => void) | undefined;
	private inputBuffer = "";
	/** Stable input row count — updated only when the editor content
	 *  changes, not on every frame. Prevents viewport jitter from
	 *  autocomplete open/close oscillations. */
	private stableInputRows = INPUT_ROWS;
	private readonly onQuit?: () => void;
	/** Messages typed while a turn is running — flushed one-per-turn as
	 *  each turn completes, instead of being silently dropped (the old
	 *  busy guard ate them after the editor had already cleared). */
	private readonly pendingInputs: string[] = [];
	/** Timer for auto-dismissing the plan panel after a terminal status. */
	private planDismissTimer: ReturnType<typeof setTimeout> | undefined = undefined;

	constructor(deps: AppDeps) {
		super();
		this.agent = deps.agent;
		this.sessionId = deps.sessionId;
		this.modelLabel = deps.modelLabel;
		this.onQuit = deps.onQuit;
		this.store = createAppStore();
		this.header = new Header(this.modelLabel, this.sessionId, emptyStats(), "idle");
		this.statusBar = new StatusBar(this.modelLabel, 0, 0);
		this.viewport = new ChatViewport({
			items: [],
			scrollOffset: 0,
			hasNew: false,
			fileSnapshots: this.fileSnapshots,
		});
		this.todoChild = new TodoPill([], false, this.animator);

		this.addChild(this.header);
		this.addChild(this.viewport);
		this.addChild(this.todoChild);
		this.addChild(this.statusBar);

		this.animator.onTick(() => this.tui?.requestRender());
	}

	attach(tui: TUI): void {
		this.tui = tui;
		this.store.setRenderTrigger(() => {
			// Drive the rolling-stone animation off busy transitions:
			// animate at 150ms while a turn runs, freeze on idle.
			const busyNow = this.store.getState().busy;
			if (busyNow !== this.wasBusy) {
				this.wasBusy = busyNow;
				if (busyNow) this.animator.start();
				else this.animator.stop();
			}
			// Flush queued input when a turn finishes. One at a time — each
			// submission re-enters busy state, so the rest drain on the
			// following transitions. Deferred to escape the dispatch stack.
			if (!busyNow && this.pendingInputs.length > 0) {
				const next = this.pendingInputs.shift()!;
				queueMicrotask(() => this.submitUserInput(next));
			}
			// /subagent show dispatches request_sidebar — consume it here.
			const sidebarRequest = this.store.getState().sidebarRequest;
			if (sidebarRequest) {
				if (sidebarRequest === "sessions") this.openSidebar();
				else this.closeSidebar();
				queueMicrotask(() => this.store.dispatch({ type: "consume_sidebar_request" }));
			}
			this.rebuildDynamicChildren();
			this.invalidate();
			tui.requestRender();
			// /quit, /exit and idle Ctrl+C all land here — nothing else
			// consumes the flag, so the TUI would never actually exit.
			if (this.store.getState().quitRequested) {
				this.onQuit?.();
			}
		});
		this.terminalRows = tui.terminal.rows;
		this.terminalCols = tui.terminal.columns;
		this.inputBox = new InputBox({
			tui,
			onSubmit: (text) => this.submitUserInput(text),
			slashCommands: SLASH_COMMANDS,
			onChange: () => this.onInputChanged(),
		});
		this.insertBefore(this.statusBar, this.inputBox);
		tui.setFocus(this.inputBox);
		this.viewportHeight = this.computeChatHeight();
		this.prevViewportHeight = this.viewportHeight;
		this.viewport.setHeight(this.viewportHeight);
		this.rebuildDynamicChildren();
		this.invalidate();

		this.agentUnsub = this.agent.subscribeToAgentEvents((event) => {
			this.captureFileSnapshot(event);
			const action = eventToAction(event as never);
			if (action) this.store.dispatch(action);

			// Show the current tool name in the header so the user
			// knows what's happening instead of just "idle"/"thinking".
			if (event.type === "tool_execution_start") {
				this.store.dispatch({
					type: "set_last_op",
					op: `running ${event.toolName}…`,
				});
			} else if (event.type === "agent_end") {
				this.store.dispatch({ type: "set_last_op", op: "idle" });
			}

			// Re-render plan/todo children when busy/items change.
			this.rebuildDynamicChildren();
		});

		this.planUnsub = this.agent.subscribeToPlanEvents((event) => {
			// Keep planRef in sync so subsequent plan events see the latest plan.
			this.planRef.current = this.store.getState().plan;
			const action = planEventToAction(event as never, this.planRef);
			if (action) this.store.dispatch(action);

			// Auto-dismiss the plan panel after it reaches a terminal
			// status (completed / failed / cancelled) so it doesn't
			// stick around permanently.
			if (
				event.type === "plan_completed" ||
				event.type === "plan_cancelled" ||
				(event.type === "plan_step_failed" && event.planStatus === "failed")
			) {
				if (this.planDismissTimer) clearTimeout(this.planDismissTimer);
				this.planDismissTimer = setTimeout(() => {
					this.store.dispatch({ type: "clear_plan" });
					this.planDismissTimer = undefined;
				}, PLAN_DISMISS_DELAY_MS);
			}

			this.rebuildDynamicChildren();
		});

		this.compactUnsub = this.agent.subscribeToCompactEvents((event) => {
			const action = compactEventToAction(event as never);
			if (action) this.store.dispatch(action);
			this.rebuildDynamicChildren();
		});

		this.agent.setToolPermissionHandler((req) => this.permissionGate(req));
		this.tickStats();
		this.statsInterval = setInterval(() => this.tickStats(), STATS_TICK_MS);

		const shortcuts: GlobalShortcutCallbacks = {
			onToggleSidebar: () => this.toggleSidebar(),
			onOpenPalette: () => this.openPalette(),
			onClear: () => this.store.dispatch({ type: "clear_items" }),
			onAbort: () => this.handleAbort(),
			onQuit: () => this.store.dispatch({ type: "request_quit" }),
			onTogglePlan: () => this.togglePlan(),
			onUndo: () => void runSlash("/undo", this.agent, this.store.getState(), this.store.dispatch, {
				openResumePrompt: () => this.showResumePrompt(),
			}),
			// Ctrl+O: toggle collapse on every collapsible item the
			// viewport currently shows. "Any collapsed → expand all",
			// "all expanded → collapse all" — so a single key press
			// opens a wall of reasoning + tool args in one go, and
			// a second press folds it back. Per-item focus tracking
			// was tried first but with no cursor in the chat
			// viewport there was no honest "the item I'm looking at"
			// signal to fall back on, so Ctrl+O always toggled the
			// most recent item even when the user was scrolled up
			// reading history. Per-viewport mass toggle sidesteps
			// the focus question entirely.
			onToggleCollapse: () => {
				const ids = this.collectVisibleCollapsibleIds();
				if (ids.length === 0) return;
				this.store.dispatch({
					type: "toggle_collapsed_visible",
					itemIds: ids,
				});
			},
			onScrollUp: (lines) => this.store.dispatch({ type: "scroll_up", lines }),
			onScrollDown: (lines) => this.store.dispatch({ type: "scroll_down", lines }),
			onScrollBottom: () => this.store.dispatch({ type: "scroll_bottom" }),
		};
		const listener = buildShortcutListener(shortcuts, () => this.computeChatHeight());
		this.inputListenerUnsub = tui.addInputListener(listener);

		// Paused/interrupted plans used to pop a modal resume prompt at
		// startup — that stole focus from the input and forced a choice
		// before the user had typed anything. Now the agent reconciles
		// interrupted plans to `paused` on boot (PhusAgent.reconcile…)
		// and the user opens the resume UI explicitly via /resume. A
		// non-blocking one-line hint is enough.
		const interrupted = this.agent.getInterruptedPlans();
		if (interrupted.length > 0) {
			this.store.dispatch({
				type: "add_system",
				text: `${interrupted.length} paused plan${interrupted.length === 1 ? "" : "s"} available — type /resume to continue`,
				level: "info",
			});
		}
	}

	/** Public wrapper so the /resume slash command can pop the prompt
	 *  on demand. Replaces the old startup auto-pop. */
	/** Called by InputBox when the editor content changes. Snapshots the
	 *  current input height so the frame budget stays stable between
	 *  keystrokes — only actual text/autocomplete changes move the budget,
	 *  not every animation frame. */
	private onInputChanged(): void {
		this.stableInputRows = this.measureRows(this.inputBox, INPUT_ROWS);
		// Input height changed (typing, autocomplete open/close, multi-
		// line wrap) → re-measure every dynamic child and refit the
		// chat viewport. Without this, the input box visually grows
		// but the viewport keeps its old height, so the bottom rows
		// of the chat are overlapped by the new input — the user sees
		// the conversation "pushed up" or "scroll to top" depending
		// on which rows get covered.
		this.rebuildDynamicChildren();
	}

	public showResumePrompt(): void {
		const plans = this.agent.getInterruptedPlans();
		if (plans.length === 0) {
			this.store.dispatch({
				type: "add_system",
				text: "no paused plans to resume",
				level: "info",
			});
			return;
		}
		this.openResumePrompt(plans);
	}

	private openResumePrompt(plans: import("@phus/runtime/core/runtime/plan/types.js").Plan[]): void {
		if (this.resumeChild) return;
		const prompt = new ResumePrompt(
			plans,
			(planId) => {
				this.closeResumePrompt();
				this.resumePlanById(planId);
			},
			(planId) => {
				this.abandonPlanById(planId);
				// Refresh the prompt with what's left (or close when empty).
				const remaining = this.agent.getInterruptedPlans();
				if (remaining.length === 0) this.closeResumePrompt();
				else {
					this.closeResumePrompt();
					this.openResumePrompt(remaining);
				}
			},
			() => this.closeResumePrompt(),
		);
		this.resumeChild = prompt;
		this.insertBefore(this.inputBox, prompt);
		if (this.tui) {
			this.inputBox.releaseFocus();
			this.tui.setFocus(prompt);
		}
		this.invalidate();
	}

	private closeResumePrompt(): void {
		if (this.resumeChild) {
			this.removeChild(this.resumeChild);
			this.resumeChild = undefined;
		}
		if (this.tui) {
			this.tui.setFocus(this.inputBox);
			this.inputBox.claimFocus();
		}
		this.invalidate();
	}

	private resumePlanById(planId: string): void {
		const runner = this.agent.getPlanRunner();
		const store = this.agent.getPlanStore();
		if (!runner || !store) return;
		const plan = store.load(planId);
		if (!plan) return;
		this.store.dispatch({ type: "set_busy", busy: true });
		this.store.dispatch({ type: "set_last_op", op: "resuming plan…" });
		void (async () => {
			try {
				const updated = await runner.runPlan(plan);
				this.store.dispatch({
					type: "add_system",
					text: `plan ${updated.id} ${updated.status}`,
					level: updated.status === "completed" ? "info" : "warn",
				});
			} catch (err) {
				this.store.dispatch({
					type: "add_system",
					text: `plan failed: ${err instanceof Error ? err.message : String(err)}`,
					level: "error",
				});
			} finally {
				this.store.dispatch({ type: "set_busy", busy: false });
				this.store.dispatch({ type: "set_last_op", op: "idle" });
			}
		})();
	}

	private abandonPlanById(planId: string): void {
		const store = this.agent.getPlanStore();
		const plan = store?.load(planId);
		if (!store || !plan) return;
		plan.status = "failed";
		plan.updatedAt = Date.now();
		for (const s of plan.steps) {
			if (s.status === "pending" || s.status === "running") s.status = "skipped";
		}
		store.save(plan);
		this.store.dispatch({
			type: "add_system",
			text: `plan ${planId.slice(0, 8)} abandoned`,
			level: "warn",
		});
	}

	private toggleSidebar(): void {
		if (this.sidebarOpen) this.closeSidebar();
		else this.openSidebar();
	}

	private openSidebar(): void {
		if (this.sidebarOpen) return;
		this.sidebarOpen = true;
		const sessions = this.agent.listSessions({ includeArchived: true });
		const panel = new SessionsPanel(
			sessions,
			this.agent.getCurrentSessionId(),
			(sid) => {
				this.closeSidebar();
				void runSlash(`/use ${sid}`, this.agent, this.store.getState(), this.store.dispatch, {
					openResumePrompt: () => this.showResumePrompt(),
				});
			},
			() => this.closeSidebar(),
			(sid) => {
				void this.agent.archiveSession(sid);
				this.openSidebar();
			},
			(sid) => {
				void this.agent.reopenSession(sid);
				this.openSidebar();
			},
		);
		this.sidebarChild = panel;
		this.insertBefore(this.inputBox, panel);
		if (this.tui) {
			this.inputBox.releaseFocus();
			this.tui.setFocus(panel);
		}
		this.rebuildDynamicChildren();
		this.invalidate();
	}

	private closeSidebar(): void {
		this.sidebarOpen = false;
		if (this.sidebarChild) {
			this.removeChild(this.sidebarChild);
			this.sidebarChild = undefined;
		}
		if (this.tui) {
			this.tui.setFocus(this.inputBox);
			this.inputBox.claimFocus();
		}
		this.rebuildDynamicChildren();
		this.invalidate();
	}

	private openPalette(): void {
		if (this.paletteOpen) {
			this.closePalette();
			return;
		}
		this.paletteOpen = true;
		const palette = new CommandPalette(
			SLASH_COMMANDS,
			(name) => {
				// Replace, don't append: picking a command from the palette
				// means that command is what the input should become.
				this.inputBox.setText(`/${name} `);
				this.closePalette();
			},
			() => this.closePalette(),
		);
		this.paletteChild = palette;
		this.insertBefore(this.inputBox, palette);
		if (this.tui) {
			this.inputBox.releaseFocus();
			this.tui.setFocus(palette);
		}
		this.rebuildDynamicChildren();
		this.invalidate();
	}

	private closePalette(): void {
		this.paletteOpen = false;
		if (this.paletteChild) {
			this.removeChild(this.paletteChild);
			this.paletteChild = undefined;
		}
		if (this.tui) {
			this.tui.setFocus(this.inputBox);
			this.inputBox.claimFocus();
		}
		this.rebuildDynamicChildren();
		this.invalidate();
	}

	private togglePlan(): void {
		if (!this.store.getState().plan) return;
		this.planExpanded = !this.planExpanded;
		if (this.planChild) {
			const next = new PlanPanel(this.store.getState().plan!, this.planExpanded);
			this.replaceChildByRef(this.planChild, next);
			this.planChild = next;
		}
		this.invalidate();
	}

	private handleAbort(): void {
		// While an overlay owns focus, Ctrl+C cancels the overlay instead
		// of quitting — the global listener runs before focused input.
		if (this.paletteOpen) {
			this.closePalette();
			return;
		}
		if (this.sidebarOpen) {
			this.closeSidebar();
			return;
		}
		if (this.resumeChild) {
			this.closeResumePrompt();
			return;
		}
		const state = this.store.getState();
		if (state.busy) {
			void this.agent.abort?.();
			this.store.dispatch({ type: "set_busy", busy: false });
			// Drain the pending-input queue. The render trigger fires
			// off every busy→false transition and would otherwise
			// shift the next queued message into a fresh turn —
			// a hot loop of "abort turn N → queue dispatches turn N+1
			// → user hits Ctrl+C again". Clearing here matches the
			// user's intent: "stop everything that was queued behind
			// the turn I'm killing." Lost messages are surfaced as
			// a single system warn so the user can re-submit if they
			// care; the cost of dropping is bounded to one
			// confirmation line.
			const dropped = this.pendingInputs.length;
			if (dropped > 0) this.pendingInputs.length = 0;
			this.store.dispatch({
				type: "add_system",
				text:
					dropped > 0
						? `⚠ the stone slipped — turn aborted, ${dropped} queued message${dropped === 1 ? "" : "s"} dropped`
						: "⚠ the stone slipped — turn aborted",
				level: "warn",
			});
		} else if (state.quitConfirmPending) {
			// Second Ctrl+C: actually quit
			this.store.dispatch({ type: "request_quit" });
		} else {
			// First Ctrl+C: show confirmation prompt
			this.store.dispatch({ type: "add_system", text: "⏎ Ctrl+C again to quit", level: "info" });
			this.store.dispatch({ type: "set_quit_confirm_pending", pending: true });
			// Auto-clear confirmation after 3 seconds
			setTimeout(() => {
				this.store.dispatch({ type: "set_quit_confirm_pending", pending: false });
			}, 3000);
		}
	}

	/** Submit free-form user input. M4 will route through the Editor. */
	submitUserInput(text: string): void {
		const state = this.store.getState();
		if (!text.trim()) return;
		if (text.startsWith("/") || text.startsWith(",")) {
			void (async () => {
				const result = await runSlash(text, this.agent, state, this.store.dispatch, {
					openResumePrompt: () => this.showResumePrompt(),
				});
				if (result === "quit") this.store.dispatch({ type: "request_quit" });
			})();
			return;
		}
		// Busy: queue instead of dropping — submitMessage's busy guard would
		// silently eat the text the editor just cleared. The queue drains
		// one message per completed turn (see the render trigger).
		if (state.busy) {
			this.pendingInputs.push(text);
			this.store.dispatch({
				type: "add_system",
				text: `⏳ queued (${this.pendingInputs.length}) — the stone picks it up next · /interrupt aborts the current turn`,
				level: "info",
			});
			return;
		}
		void submitMessage(text, {
			agent: this.agent,
			state,
			dispatch: this.store.dispatch,
			setInput: () => {},
			channel: (d, getItems) => tuiChannel(d, () => ({ items: getItems() })),
			getItems: () => this.store.getState().items,
			clearChat: () => this.store.dispatch({ type: "clear_items" }),
		});
	}

	detach(): void {
		this.agentUnsub?.();
		this.planUnsub?.();
		this.compactUnsub?.();
		this.inputListenerUnsub?.();
		this.animator.stop();
		if (this.statsInterval) clearInterval(this.statsInterval);
		this.statsInterval = undefined;
		if (this.planDismissTimer) clearTimeout(this.planDismissTimer);
	}

	private captureFileSnapshot(event: unknown): void {
		const e = event as { type?: string; toolName?: string; toolCallId?: string; args?: unknown };
		if (e.type !== "tool_execution_start" || e.toolName !== "file_write") return;
		const args = e.args as { path?: string } | undefined;
		if (!args?.path || !e.toolCallId) return;
		const toolCallId = e.toolCallId;
		const path = args.path;
		setImmediate(() => {
			try {
				const content = readFileSync(path, "utf-8");
				this.fileSnapshots.set(toolCallId, { path, content });
			} catch {
				this.fileSnapshots.set(toolCallId, { path, content: "" });
			}
		});
	}

	private async permissionGate(req: {
		toolName: string;
		args: unknown;
		toolCallId: string;
	}): Promise<boolean> {
		const state = this.store.getState();
		if (state.allowedTools.has(req.toolName) || state.sessionAllowedTools.has(req.toolName)) {
			return true;
		}
		if (!DANGEROUS_TOOLS.has(req.toolName)) return true;

		if (req.toolName === "memory_write") {
			const parsed = parseMemoryAction(req.args);
			const verdict = await this.agent.getAutonomyGate().decide(parsed);
			if (verdict === "auto") return true;
		}

		return new Promise<boolean>((resolve) => {
			const request: PermissionRequest = {
				id: `${req.toolCallId}-${Date.now()}`,
				toolName: req.toolName,
				args: req.args,
				toolCallId: req.toolCallId,
				caption:
					req.toolName === "memory_write"
						? describeMemoryAction(req.args)
						: req.toolName === "file_write"
							? describeFileWrite(req.args)
							: undefined,
				preview:
					req.toolName === "memory_write"
						? buildMemoryPreview(req.args)
						: req.toolName === "file_write"
							? buildFileWritePreview(req.args)
							: undefined,
				resolve,
			};
			this.store.dispatch({ type: "push_permission", request });
		});
	}

	private tickStats(): void {
		try {
			const tape = this.agent.replayTape();
			let checkpoints = 0;
			let lastCheckpointAt: number | undefined;
			for (const entry of tape) {
				if ((entry as { kind?: string }).kind === "checkpoint") {
					checkpoints++;
					const ts = (entry as { ts?: number }).ts;
					if (ts && (!lastCheckpointAt || ts > lastCheckpointAt)) lastCheckpointAt = ts;
				}
			}
			const state = this.store.getState();
			this.headerStats = {
				entries: this.agent.getTapeTotalEntries(),
				skills: this.agent.getSkillCount(),
				turns: this.agent.getMessageCount(),
				checkpoints,
				lastCheckpointAt,
			};
			this.lastOp = state.lastOp;
			this.refreshHeaderAndStatusBar();
		} catch {
			// Agent may be mid-bootstrap; skip this tick.
		}
	}

		/**
	 * Walk `state.items` from the bottom up, accumulating approximate
	 * rendered heights until we cover the viewport. Returns the ids of
	 * every collapsible item (`tool_call` / `assistant`) inside that
	 * window — what Ctrl+O should target. Heuristic only: we don't
	 * have the actual rendered heights here, so we estimate each
	 * item at `MAX_ITEM_ROWS`. That deliberately over-estimates, so
	 * the visible window may include a couple of "barely off-screen"
	 * items at the top edge — those are part of the toggle group too
	 * and toggling them is harmless.
	 */
	private collectVisibleCollapsibleIds(): string[] {
		const state = this.store.getState();
		const { items, scroll } = state;
		if (items.length === 0) return [];
		// Approximate the viewport's row budget as terminal rows minus
		// everything that ISN'T chat. The exact arithmetic lives in
		// computeChatHeight, but the small discrepancy (a few rows)
		// is well within the "fine to toggle" tolerance for a mass
		// collapse action.
		const viewportRows = Math.max(6, (this.terminalRows ?? 24) - 8);
		const offset = Math.max(0, scroll.offset);
		// Bottom-anchored: start from the end, walk backwards.
		let rowsFromBottom = 0;
		const want = viewportRows + offset;
		const start = (() => {
			for (let i = items.length - 1; i >= 0; i--) {
				rowsFromBottom += MAX_ITEM_ROWS;
				if (rowsFromBottom >= want) return i;
			}
			return 0;
		})();
		const out: string[] = [];
		for (let i = start; i < items.length; i++) {
			const it = items[i]!;
			if (it.kind === "tool_call" || it.kind === "assistant") {
				out.push(it.id);
			}
		}
		return out;
	}

	private refreshHeaderAndStatusBar(): void {
		const state = this.store.getState();
		const newHeader = new Header(this.modelLabel, this.sessionId, this.headerStats, state.lastOp);
		const newStatus = new StatusBar(this.modelLabel, this.headerStats.skills, this.headerStats.entries);
		this.replaceChildByRef(this.header, newHeader);
		this.replaceChildByRef(this.statusBar, newStatus);
		(this as unknown as { header: Header }).header = newHeader;
		(this as unknown as { statusBar: StatusBar }).statusBar = newStatus;
		this.invalidate();
		// tickStats runs on a timer, outside any dispatch — without an
		// explicit render request the swapped header/status never paints
		// (frozen "thinking…" + stale counters after the turn ends).
		this.tui?.requestRender();
	}

	private rebuildDynamicChildren(): void {
		const state = this.store.getState();
		// PermissionPanel — show only when there's a pending request and
		// no sidebar / palette overlay.
		const wantPermission = !!state.permissionQueue[0] && !this.paletteOpen && !this.sidebarOpen;
		if (wantPermission && state.permissionQueue[0]) {
			if (!this.permissionChild) {
				const next = new PermissionPanel(state.permissionQueue[0], (allow, remember) =>
					this.store.dispatch({ type: "resolve_permission", allow, remember }),
				);
				this.insertBefore(this.inputBox, next);
				this.permissionChild = next;
				if (this.tui) {
					this.inputBox.releaseFocus();
					this.tui.setFocus(next);
				}
			}
		} else if (this.permissionChild) {
			this.removeChild(this.permissionChild);
			this.permissionChild = undefined;
			if (this.tui) {
				this.tui.setFocus(this.inputBox);
				this.inputBox.claimFocus();
			}
		}
		// PlanPanel — show only when there is a plan.
		if (state.plan) {
			if (!this.planChild || (this.planChild as unknown as { plan: unknown }).plan !== state.plan) {
				const next = new PlanPanel(state.plan, this.planExpanded);
				if (this.planChild) this.replaceChildByRef(this.planChild, next);
				else this.insertBefore(this.todoChild, next);
				this.planChild = next;
			}
		} else if (this.planChild) {
			this.removeChild(this.planChild);
			this.planChild = undefined;
		}
		// TodoPill — refresh contents every event so the rolling stone and
		// the running-tool pill stay live.
		const nextTodo = new TodoPill(state.items, state.busy, this.animator);
		this.replaceChildByRef(this.todoChild, nextTodo);
		this.todoChild = nextTodo;
	}

	private insertBefore(target: Component, child: Component): void {
		const idx = this.children.indexOf(target);
		if (idx < 0) {
			this.addChild(child);
			return;
		}
		this.children.splice(idx, 0, child);
		this.invalidate();
	}

	invalidate(): void {
		super.invalidate();
		this.header.invalidate();
		this.statusBar.invalidate();
		if (this.tui) {
			// Track terminal resizes — the TUI re-renders on SIGWINCH, and
			// the chat height math must follow or the frame overflows.
			this.terminalRows = this.tui.terminal.rows;
			this.terminalCols = this.tui.terminal.columns;
			const newHeight = this.computeChatHeight();
			// When the viewport height changes (e.g. tool_call expanding,
			// plan panel toggling, input wrapping), force a full TUI redraw
			// so the differential render doesn't leave stale rows from the
			// old frame budget overlapping the new layout.
			if (newHeight !== this.prevViewportHeight) {
				this.prevViewportHeight = newHeight;
				this.tui.requestRender(true);
			}
			this.viewportHeight = newHeight;
			this.viewport.setHeight(this.viewportHeight);
			const s = this.store.getState();
			this.viewport.setDeps({
				items: s.items,
				scrollOffset: s.scroll.offset,
				hasNew: s.scroll.hasNew,
				fileSnapshots: this.fileSnapshots,
				stoneFrame: this.animator.frame(),
			});
		}
	}

	/** Measure a child's real rendered height so the frame budget always
	 *  matches what actually lands on screen. Falls back to the static
	 *  constant when the child isn't mounted yet. */
	private measureRows(child: Component | undefined, fallback: number): number {
		if (!child) return fallback;
		try {
			return child.render(this.terminalCols).length;
		} catch {
			return fallback;
		}
	}

	private computeChatHeight(): number {
		const state = this.store.getState();
		const planRows = state.plan
			? this.measureRows(this.planChild, this.planExpanded ? PLAN_ROWS_EXPANDED : PLAN_ROWS_COLLAPSED)
			: 0;
		// Measured unconditionally: TodoPill renders 0 rows when idle and
		// 1 when busy — the budget must track the real height either way.
		const todoRows = this.measureRows(this.todoChild, TODO_ROWS);
		const permRows =
			state.permissionQueue[0] && !this.paletteOpen && !this.sidebarOpen
				? this.measureRows(this.permissionChild, PERMISSION_ROWS)
				: 0;
		const paletteRows = this.paletteOpen ? this.measureRows(this.paletteChild, 0) : 0;
		const sidebarRows = this.sidebarOpen ? this.measureRows(this.sidebarChild, 0) : 0;
		const resumeRows = this.resumeChild ? this.measureRows(this.resumeChild, 0) : 0;
    // Use the stable snapshot so autocomplete open/close doesn't
    // oscillate the viewport height on every frame.
    const inputRows = this.stableInputRows;
		return Math.max(
			MIN_CHAT_HEIGHT,
			this.terminalRows -
				HEADER_ROWS -
				STATUS_ROWS -
				inputRows -
				planRows -
				todoRows -
				permRows -
				paletteRows -
				sidebarRows -
				resumeRows,
		);
	}

	getStore(): AppStore {
		return this.store;
	}
}

function emptyStats(): HeaderStats {
	return { entries: 0, skills: 0, turns: 0, checkpoints: 0 };
}
