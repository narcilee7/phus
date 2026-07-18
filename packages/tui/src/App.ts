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
import { Container, type TUI, type Component } from "@/vendor/pi-tui/tui.js";
import { Header, type HeaderStats } from "@/components/base/Header.js";
import { StatusBar } from "@/components/base/StatusBar.js";
import { ChatViewport } from "@/components/chat/ChatViewport.js";
import { PlanPanel } from "@/components/agent/PlanPanel.js";
import { TodoPill } from "@/components/todo/TodoPill.js";
import {
	HEADER_ROWS,
	STATUS_ROWS,
	MIN_CHAT_HEIGHT,
	STATS_TICK_MS,
	PLAN_ROWS_COLLAPSED,
	TODO_ROWS,
	DANGEROUS_TOOLS,
} from "@/constants.js";
import { createAppStore, type AppStore } from "@/runtime/app-state.js";
import { Spinner } from "@/runtime/spinner.js";
import { eventToAction } from "@/transform/events.js";
import { planEventToAction, type PlanRef } from "@/transform/plan-events.js";
import { describeMemoryAction, buildMemoryPreview } from "@/transform/memory.js";
import { parseMemoryAction } from "@phus/runtime/infra/meta/index.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppState, PermissionRequest } from "@/state/state.js";

export interface AppDeps {
	readonly agent: PhusAgent;
	readonly sessionId: string;
	readonly modelLabel: string;
}

interface FileSnapshot {
	path: string;
	content: string;
}

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
	private readonly spinner = new Spinner();
	private headerStats: HeaderStats = emptyStats();
	private lastOp = "idle";
	private terminalRows = 24;
	private statsInterval: ReturnType<typeof setInterval> | undefined;
	private agentUnsub: (() => void) | undefined;
	private planUnsub: (() => void) | undefined;
	private readonly planRef: PlanRef = { current: undefined };
	private viewportHeight = MIN_CHAT_HEIGHT;
	private todoChild: TodoPill;
	private planChild?: PlanPanel;

	constructor(deps: AppDeps) {
		super();
		this.agent = deps.agent;
		this.sessionId = deps.sessionId;
		this.modelLabel = deps.modelLabel;
		this.store = createAppStore();
		this.header = new Header(this.modelLabel, this.sessionId, emptyStats(), "idle");
		this.statusBar = new StatusBar(this.modelLabel, 0, 0);
		this.viewport = new ChatViewport({
			items: [],
			busy: false,
			scrollOffset: 0,
			hasNew: false,
			lastOp: "idle",
			fileSnapshots: this.fileSnapshots,
		});
		this.todoChild = new TodoPill([], false, "idle");

		this.addChild(this.header);
		this.addChild(this.viewport);
		this.addChild(this.todoChild);
		this.addChild(this.statusBar);

		this.spinner.onTick(() => this.tui?.requestRender());
	}

	attach(tui: TUI): void {
		this.tui = tui;
		this.store.setRenderTrigger(() => {
			this.rebuildDynamicChildren();
			this.invalidate();
			tui.requestRender();
		});
		this.terminalRows = tui.terminal.rows;
		this.viewportHeight = this.computeChatHeight();
		this.viewport.setHeight(this.viewportHeight);
		this.rebuildDynamicChildren();
		this.invalidate();

		this.agentUnsub = this.agent.subscribeToAgentEvents((event) => {
			this.captureFileSnapshot(event);
			const action = eventToAction(event as never);
			if (action) this.store.dispatch(action);
			// Re-render plan/todo children when busy/items change.
			this.rebuildDynamicChildren();
		});

		this.planUnsub = this.agent.subscribeToPlanEvents((event) => {
			// Keep planRef in sync so subsequent plan events see the latest plan.
			this.planRef.current = this.store.getState().plan;
			const action = planEventToAction(event as never, this.planRef);
			if (action) this.store.dispatch(action);
			this.rebuildDynamicChildren();
		});

		this.agent.setToolPermissionHandler((req) => this.permissionGate(req));
		this.tickStats();
		this.statsInterval = setInterval(() => this.tickStats(), STATS_TICK_MS);
	}

	detach(): void {
		this.agentUnsub?.();
		this.planUnsub?.();
		if (this.statsInterval) clearInterval(this.statsInterval);
		this.statsInterval = undefined;
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
				caption: req.toolName === "memory_write" ? describeMemoryAction(req.args) : undefined,
				preview: req.toolName === "memory_write" ? buildMemoryPreview(req.args) : undefined,
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

	private refreshHeaderAndStatusBar(): void {
		const state = this.store.getState();
		const newHeader = new Header(this.modelLabel, this.sessionId, this.headerStats, state.lastOp);
		const newStatus = new StatusBar(this.modelLabel, this.headerStats.skills, this.headerStats.entries);
		this.replaceChildByRef(this.header, newHeader);
		this.replaceChildByRef(this.statusBar, newStatus);
		(this as unknown as { header: Header }).header = newHeader;
		(this as unknown as { statusBar: StatusBar }).statusBar = newStatus;
		this.invalidate();
	}

	private rebuildDynamicChildren(): void {
		const state = this.store.getState();
		// PlanPanel — show only when there is a plan.
		if (state.plan) {
			if (!this.planChild || this.planChild["plan"] !== state.plan) {
				const next = new PlanPanel(state.plan, false);
				if (this.planChild) this.replaceChildByRef(this.planChild, next);
				else this.insertBefore(this.todoChild, next);
				this.planChild = next;
			}
		} else if (this.planChild) {
			this.removeChild(this.planChild);
			this.planChild = undefined;
		}
		// TodoPill — refresh contents every event so busy pill is live.
		const nextTodo = new TodoPill(state.items, state.busy, state.lastOp);
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
		this.spinner.invalidate();
		if (this.tui) {
			this.viewport.setHeight(this.computeChatHeight());
			const s = this.store.getState();
			this.viewport.setDeps({
				items: s.items,
				busy: s.busy,
				scrollOffset: s.scroll.offset,
				hasNew: s.scroll.hasNew,
				lastOp: s.lastOp,
				fileSnapshots: this.fileSnapshots,
			});
		}
	}

	private computeChatHeight(): number {
		const state = this.store.getState();
		const planRows = state.plan ? PLAN_ROWS_COLLAPSED : 0;
		const todoRows =
			state.busy ||
			state.items.some((it) => it.kind === "tool_call" && it.isError === undefined)
				? TODO_ROWS
				: 0;
		return Math.max(
			MIN_CHAT_HEIGHT,
			this.terminalRows - HEADER_ROWS - STATUS_ROWS - planRows - todoRows,
		);
	}

	getSpinner(): Spinner {
		return this.spinner;
	}

	getStore(): AppStore {
		return this.store;
	}
}

function emptyStats(): HeaderStats {
	return { entries: 0, skills: 0, turns: 0, checkpoints: 0 };
}
