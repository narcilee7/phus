// src/tui/App.tsx
// TUI root. Composes the layout components and dispatches events
// into the state reducer. All command dispatching lives in
// ./commands.ts; all event → action mapping in ./events.ts.

import React, { useEffect, useReducer, useRef } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import { readFile, writeFile } from "node:fs/promises";
import type { PhusAgent } from "@/bridge/pi-agent.js";

import { appReducer, initialState } from "@/tui/state.js";
import { Header } from "@/tui/components/Header.js";
import { ChatViewport } from "@/tui/components/ChatViewport.js";
import { TodoPill } from "@/tui/components/TodoPill.js";
import { PlanPanel } from "@/tui/components/PlanPanel.js";
import { InputBox } from "@/tui/components/InputBox.js";
import { TuiLayoutProvider, useTuiLayout } from "@/tui/layout-context.js";
import { PermissionPanel } from "@/tui/components/PermissionPanel.js";
import { CommandPalette, type PaletteAction } from "@/tui/components/CommandPalette.js";
import { StatusBar } from "@/tui/components/StatusBar.js";
import { FileTree } from "@/tui/components/FileTree.js";
import { eventToAction } from "@/tui/events.js";
import { runSlash } from "@/tui/commands.js";
import { tuiChannel } from "@/tui/channel.js";
import type { RememberChoice } from "@/tui/state.js";
import { extractMentions, readFileMention, buildContextBlock } from "@/tui/mentions.js";
import { parseMemoryAction } from "@/infra/meta/memory-tools.js";
import {
  CodeActionContext,
  type CodeBlockAction,
} from "@/tui/components/CodeActionContext.js";
import {
  DiffReviewContext,
  type DiffReviewAction,
} from "@/tui/components/DiffReviewContext.js";
import { TuiFocusContext } from "@/tui/components/TuiFocusContext.js";
import { copyToClipboard, runCode } from "@/tui/code-actions.js";

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
  modelLabel: string;
}

export function App({ agent, sessionId, modelLabel }: AppProps) {
  return (
    <TuiLayoutProvider>
      <AppInner agent={agent} sessionId={sessionId} modelLabel={modelLabel} />
    </TuiLayoutProvider>
  );
}

function AppInner({ agent, sessionId, modelLabel }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { bottomOverlayRows } = useTuiLayout();
  const [input, setInput] = React.useState("");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [focusedKind, setFocusedKind] = React.useState<import("@/tui/components/TuiFocusContext.js").FocusKind | null>(null);
  const [lastWriteTs, setLastWriteTs] = React.useState<number | undefined>(undefined);
  const writeHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevItemsRef = useRef(state.items);
  const [stats, setStats] = React.useState({
    entries: 0,
    skills: 0,
    turns: 0,
    checkpoints: 0,
    lastCheckpointAt: undefined as number | undefined,
  });
  const fileSnapshots = useRef(new Map<string, { path: string; content: string }>());
  const itemsRef = useRef(state.items);
  itemsRef.current = state.items;
  const planRef = useRef(state.plan);
  planRef.current = state.plan;
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = React.useState(stdout.rows);

  const DANGEROUS_TOOLS = React.useMemo(
    () => new Set(["bash", "file_write", "startup_write", "skill_write", "skill_delete", "memory_write"]),
    [],
  );

  // ─── Code block actions ────────────────────────────────────────
  const handleCodeAction = React.useCallback(
    async (action: CodeBlockAction) => {
      if (action.type === "copy") {
        try {
          await copyToClipboard(action.code);
          dispatch({ type: "add_system", text: "✓ copied to clipboard", level: "info" });
        } catch (err: any) {
          dispatch({
            type: "add_system",
            text: `copy failed: ${err.message ?? err}`,
            level: "error",
          });
        }
      } else if (action.type === "run") {
        dispatch({ type: "add_system", text: `running ${action.language}…`, level: "info" });
        try {
          const { output, exitCode } = await runCode(action.language, action.code);
          const status = exitCode === 0 ? "✓" : `✗ exit ${exitCode}`;
          dispatch({
            type: "add_system",
            text: `${status} ${action.language}\n${output}`,
            level: exitCode === 0 ? "info" : "warn",
          });
        } catch (err: any) {
          dispatch({
            type: "add_system",
            text: `run failed: ${err.message ?? err}`,
            level: "error",
          });
        }
      } else if (action.type === "insert") {
        setInput((prev) => prev + action.code);
        dispatch({ type: "add_system", text: "✓ code inserted into input", level: "info" });
      }
    },
    [dispatch],
  );

  const codeActionValue = React.useMemo(
    () => ({
      onAction: handleCodeAction,
    }),
    [handleCodeAction],
  );

  const handleDiffReviewAction = React.useCallback(
    async (action: DiffReviewAction) => {
      if (action.type === "accept") {
        dispatch({
          type: "add_system",
          text: `✓ accepted changes to ${action.path}`,
          level: "info",
        });
      } else if (action.type === "reject") {
        try {
          await writeFile(action.path, action.oldContent);
          dispatch({ type: "add_system", text: `✓ reverted ${action.path}`, level: "info" });
        } catch (err: any) {
          dispatch({
            type: "add_system",
            text: `revert failed: ${err.message ?? err}`,
            level: "error",
          });
        }
      } else if (action.type === "edit") {
        setInput((prev) => prev + action.newContent);
        dispatch({
          type: "add_system",
          text: `✓ copied ${action.path} to input`,
          level: "info",
        });
      }
    },
    [dispatch],
  );

  const diffReviewValue = React.useMemo(
    () => ({
      onAction: handleDiffReviewAction,
    }),
    [handleDiffReviewAction],
  );

  const tuiFocusValue = React.useMemo(
    () => ({
      focusedId,
      focusedKind,
      setFocused: (id: string | null, kind?: import("@/tui/components/TuiFocusContext.js").FocusKind) => {
        setFocusedId(id);
        setFocusedKind(id ? kind ?? null : null);
      },
    }),
    [focusedId, focusedKind],
  );

  const anyInteractiveFocused = focusedId !== null;

  // ─── Layout heights ────────────────────────────────────────────
  // Reserve rows for every bottom UI element so that dynamic overlays
  // (suggestion/mention dropdowns) can expand without covering the chat.
  const HEADER_ROWS = 4;
  const INPUT_ROWS = 3;
  const STATUS_ROWS = 1;
  const PLAN_ROWS = state.plan ? 6 : 0;
  const TODO_ROWS =
    state.busy || state.items.some((it) => it.kind === "tool_call" && it.isError === undefined) ? 1 : 0;
  const PERMISSION_ROWS = state.permissionQueue[0] ? 4 : 0;
  const PALETTE_ROWS = paletteOpen ? 14 : 0;
  const bottomRows = INPUT_ROWS + STATUS_ROWS + PLAN_ROWS + TODO_ROWS + PERMISSION_ROWS + PALETTE_ROWS + bottomOverlayRows;
  const chatHeight = Math.max(6, terminalRows - HEADER_ROWS - bottomRows);
  // The sidebar shares the full right-column height, including the bottom UI
  // (input, status bar, plan/permission/palette). This avoids an empty strip
  // below the file tree when those panels are open.
  const sidebarHeight = Math.max(10, terminalRows - HEADER_ROWS);
  const statusHint = paletteOpen
    ? "↑↓ navigate · Enter select · Esc close"
    : focusedKind === "codeblock"
      ? "c copy · r run · i insert · Esc input"
      : focusedKind === "diffreview"
        ? "a accept · r reject · e edit · Esc input"
        : focusedKind === "toolcall"
          ? "Enter/Space expand · Esc input"
          : state.permissionQueue[0]
            ? "Y yes · S session · A always · N no · Esc"
            : lastWriteTs
              ? "Ctrl+Z undo · /checkpoint list"
              : undefined;

  // ─── Flash undo hint after write tools complete ─────────────────
  useEffect(() => {
    const prevMap = new Map(prevItemsRef.current.map((it) => [it.id, it]));
    const newlyCompleted = state.items.find((it) => {
      if (it.kind !== "tool_call") return false;
      if (!["file_write", "skill_write", "memory_write"].includes(it.toolName || "")) return false;
      if (it.isError === undefined) return false;
      const prev = prevMap.get(it.id);
      return !prev || prev.isError === undefined;
    });
    prevItemsRef.current = state.items;
    if (newlyCompleted) {
      setLastWriteTs(Date.now());
      if (writeHintTimeoutRef.current) clearTimeout(writeHintTimeoutRef.current);
      writeHintTimeoutRef.current = setTimeout(() => setLastWriteTs(undefined), 10000);
    }
    return () => {
      if (writeHintTimeoutRef.current) clearTimeout(writeHintTimeoutRef.current);
    };
  }, [state.items]);

  // ─── Subscribe to Pi Agent events ─────────────────────────────
  useEffect(() => {
    const unsub = agent.subscribeToAgentEvents((event: any) => {
      if (event.type === "tool_execution_start" && event.toolName === "file_write") {
        const path = event.args?.path;
        if (typeof path === "string") {
          readFile(path, "utf-8")
            .then((content) => {
              fileSnapshots.current.set(event.toolCallId, { path, content });
            })
            .catch(() => {
              fileSnapshots.current.set(event.toolCallId, { path, content: "" });
            });
        }
      }
      const action = eventToAction(event);
      if (action) dispatch(action);
    });
    return unsub;
  }, [agent]);

  // ─── Subscribe to plan runner events ────────────────────────────
  useEffect(() => {
    const unsub = agent.subscribeToPlanEvents((event) => {
      const currentPlan = planRef.current;
      if (event.type === "plan_completed") {
        dispatch({
          type: "set_plan",
          plan: {
            id: event.planId,
            goal: event.goal,
            status: event.planStatus,
            steps: currentPlan?.id === event.planId ? currentPlan.steps : [],
          },
        });
        return;
      }
      const step = event.step;
      if (!step) return;
      if (event.type === "plan_step_started") {
        if (currentPlan?.id !== event.planId) {
          dispatch({
            type: "set_plan",
            plan: {
              id: event.planId,
              goal: event.goal,
              status: event.planStatus,
              steps: [{ id: step.id, description: step.description, status: "running" }],
              currentStepId: step.id,
            },
          });
        } else {
          dispatch({ type: "update_plan_step", stepId: step.id, status: "running" });
        }
      } else {
        const status = event.type === "plan_step_completed" ? "completed" : "failed";
        dispatch({ type: "update_plan_step", stepId: step.id, status });
      }
    });
    return unsub;
  }, [agent]);

  // ─── Terminal resize tracking ────────────────────────────────
  useEffect(() => {
    const handleResize = () => setTerminalRows(stdout.rows);
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  // ─── Live status tick (every 1.5s) ───────────────────────────
  useEffect(() => {
    const tick = () => {
      try {
        let checkpoints = 0;
        let lastCheckpointAt: number | undefined;
        for (const entry of agent.replayTape()) {
          if (entry.kind === "checkpoint") {
            checkpoints++;
            const ts = entry.ts;
            if (ts && (!lastCheckpointAt || ts > lastCheckpointAt)) {
              lastCheckpointAt = ts;
            }
          }
        }
        setStats({
          entries: agent.getTapeTotalEntries(),
          skills: agent.getSkillCount(),
          turns: agent.getMessageCount(),
          checkpoints,
          lastCheckpointAt,
        });
      } catch {
        /* ignore — agent may be mid-bootstrap */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [agent]);

  // ─── Tool permission gate ──────────────────────────────────────
  useEffect(() => {
    agent.setToolPermissionHandler(async (req) => {
      if (state.allowedTools.has(req.toolName)) return true;
      if (state.sessionAllowedTools.has(req.toolName)) return true;
      if (!DANGEROUS_TOOLS.has(req.toolName)) return true;

      // memory_write consults the autonomy gate before the permission bar.
      // When the gate returns "auto" (yolo mode, or approval-list with
      // matching autoApprove), the call bypasses the prompt entirely —
      // only the tape entry + log record the decision.
      if (req.toolName === "memory_write") {
        try {
          const action = parseMemoryAction((req.args as { action?: unknown })?.action);
          const gate = agent.getAutonomyGate();
          if (gate.decide(action) === "auto") return true;
        } catch {
          // Fall through to the prompt — let the user decide if the
          // action shape is malformed.
        }
      }

      return new Promise<boolean>((resolve) => {
        const preview = req.toolName === "memory_write"
          ? buildMemoryPreview(req.args)
          : undefined;
        const caption = req.toolName === "memory_write"
          ? describeMemoryAction(req.args)
          : undefined;
        dispatch({
          type: "push_permission",
          request: {
            id: crypto.randomUUID(),
            toolName: req.toolName,
            args: req.args,
            toolCallId: req.toolCallId,
            ...(preview !== undefined ? { preview } : {}),
            ...(caption !== undefined ? { caption } : {}),
            resolve,
          },
        });
      });
    });
  }, [agent, state.allowedTools, state.sessionAllowedTools, DANGEROUS_TOOLS, dispatch]);

  // ─── Submit handler ──────────────────────────────────────────
  const submit = async (text: string) => {
    if (!text.trim() || state.busy) return;
    setInput("");
    dispatch({ type: "hide_hint" });

    if (text.startsWith("/") || text.startsWith(",")) {
      const result = await runSlash(text, agent, state, dispatch);
      if (result === "quit") exit();
      if (result === "clear") dispatch({ type: "clear_items" });
      return;
    }

    dispatch({ type: "scroll_bottom" });
    dispatch({ type: "set_busy", busy: true });
    dispatch({ type: "set_last_op", op: "thinking…" });
    dispatch({ type: "add_user", text });

    // Read @-mentioned files and inject them as a context block.
    const mentions = extractMentions(text).filter((m) => m.type === "file");
    const fileContexts: { path: string; content: string; size: number }[] = [];
    for (const mention of mentions) {
      try {
        const ctx = await readFileMention(mention.target);
        fileContexts.push({ path: ctx.path, content: ctx.content, size: ctx.size });
      } catch (err: any) {
        dispatch({
          type: "add_system",
          text: `could not read ${mention.target}: ${err.message ?? err}`,
          level: "warn",
        });
      }
    }
    const contextBlock = buildContextBlock(fileContexts);
    const content = contextBlock ? `${contextBlock}\n\n${text}` : text;

    try {
      const envelope = {
        id: crypto.randomUUID(),
        from: "user",
        content,
        type: "text" as const,
        channel: "tui",
        metadata: { chatId: "tui" },
        ts: Date.now(),
      };
      await agent.turn(envelope, tuiChannel(dispatch, () => ({ items: itemsRef.current })));
    } catch (err: any) {
      dispatch({ type: "add_system", text: `error: ${err.message ?? err}`, level: "error" });
    } finally {
      dispatch({ type: "set_busy", busy: false });
      dispatch({ type: "set_last_op", op: "idle" });
    }
  };

  // ─── Ctrl+C / Ctrl+L shortcuts + scroll keys + command palette ──
  useInput((input, key) => {
    if (paletteOpen) return;
    if (key.ctrl && input === "b" && state.permissionQueue.length === 0) {
      setSidebarOpen((open) => !open);
      return;
    }
    if (sidebarOpen) return;
    if (anyInteractiveFocused && key.escape) {
      setFocusedId(null);
      setFocusedKind(null);
      return;
    }
    if (anyInteractiveFocused && !key.ctrl && !key.meta) return;
    if ((key.ctrl || key.meta) && input === "k" && state.permissionQueue.length === 0) {
      setPaletteOpen(true);
      return;
    }
    if (key.ctrl && input === "c") {
      if (state.busy) {
        agent.abort();
        dispatch({ type: "set_busy", busy: false });
        dispatch({ type: "set_last_op", op: "idle" });
        dispatch({ type: "add_system", text: "✓ aborted by user", level: "warn" });
      } else {
        exit();
      }
    }
    if (key.ctrl && input === "l") {
      dispatch({ type: "clear_items" });
    }
    if (key.ctrl && input === "z" && !state.busy) {
      void runSlash("/undo", agent, state, dispatch);
      return;
    }
    if (key.pageUp) {
      dispatch({ type: "scroll_up", lines: Math.max(1, chatHeight - 1) });
    }
    if (key.pageDown) {
      dispatch({ type: "scroll_down", lines: Math.max(1, chatHeight - 1) });
    }
    if (key.ctrl && key.upArrow) {
      dispatch({ type: "scroll_up", lines: 1 });
    }
    if (key.ctrl && key.downArrow) {
      dispatch({ type: "scroll_down", lines: 1 });
    }
    if (key.ctrl && key.end) {
      dispatch({ type: "scroll_bottom" });
    }
  });

  // ─── Render ───────────────────────────────────────────────────
  // Chat fills all remaining space between the header and the bottom UI.
  // We compute an explicit height for ChatViewport so overflow is clipped
  // correctly when the plan panel, permission bar or command palette is open.


  return (
    <TuiFocusContext.Provider value={tuiFocusValue}>
      <CodeActionContext.Provider value={codeActionValue}>
        <DiffReviewContext.Provider value={diffReviewValue}>
          <Box flexDirection="column" height={terminalRows} overflow="hidden">
          <Header
            model={modelLabel}
            session={sessionId}
            stats={stats}
            lastOp={state.lastOp}
          />
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            {sidebarOpen && (
              <Box width={34}>
                <FileTree
                  height={sidebarHeight}
                  onInsert={(value: string) => {
                    setInput((prev) => prev + value);
                    setSidebarOpen(false);
                  }}
                  onPreview={(text: string) =>
                    dispatch({ type: "add_system", text, level: "info" })
                  }
                  onClose={() => setSidebarOpen(false)}
                />
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              <Box flexGrow={1} overflow="hidden">
                <ChatViewport
                  items={state.items}
                  busy={state.busy}
                  scrollOffset={state.scroll.offset}
                  hasNew={state.scroll.hasNew}
                  lastOp={state.lastOp}
                  fileSnapshots={fileSnapshots.current}
                  height={chatHeight}
                />
              </Box>
              {state.plan && <PlanPanel plan={state.plan} />}
              <TodoPill items={state.items} busy={state.busy} lastOp={state.lastOp} />
              {state.permissionQueue[0] && !paletteOpen && !sidebarOpen && (
                <PermissionPanel
                  request={state.permissionQueue[0]}
                  onResolve={(allow: boolean, remember: RememberChoice) =>
                    dispatch({ type: "resolve_permission", allow, remember })
                  }
                />
              )}
              {paletteOpen && (
                <CommandPalette
                  agent={agent}
                  onSelect={(value: string, action: PaletteAction) => {
                    setPaletteOpen(false);
                    if (action === "insert") {
                      setInput((prev) => prev + value);
                    } else {
                      void submit(value);
                    }
                  }}
                  onClose={() => setPaletteOpen(false)}
                />
              )}
              <StatusBar modelLabel={modelLabel} skills={stats.skills} entries={stats.entries} hint={statusHint} />
              <InputBox
                value={input}
                busy={state.busy}
                showHint={state.showHint}
                onChange={setInput}
                onSubmit={submit}
                isActive={state.permissionQueue.length === 0 && !paletteOpen && !sidebarOpen && !anyInteractiveFocused}
                agent={agent}
                mentions={extractMentions(input)
                  .filter((m) => m.type === "file")
                .map((m) => ({ path: m.target, size: 0 }))}
            />
          </Box>
        </Box>
      </Box>
        </DiffReviewContext.Provider>
      </CodeActionContext.Provider>
    </TuiFocusContext.Provider>
  );
}

// ─── Memory write preview helpers ─────────────────────────────────
// Short caption used in the permission prompt header:
//   "memory_write? (append 'Style')" / "memory_write? (replace 'Style')" / "memory_write? (delete 'Style')"
function describeMemoryAction(rawArgs: unknown): string | undefined {
  try {
    const action = parseMemoryAction((rawArgs as { action?: unknown })?.action);
    const heading = action.section.startsWith("#") ? action.section : `## ${action.section}`;
    const verb = action.kind === "append" ? "append to"
      : action.kind === "replace" ? "replace"
      : "delete";
    return `${verb} ${heading}`;
  } catch {
    return undefined;
  }
}

// Compact diff preview shown in the permission body. Kept to a few
// lines so the permission bar stays one terminal-row tall.
function buildMemoryPreview(rawArgs: unknown): string | undefined {
  try {
    const args = (rawArgs ?? {}) as { action?: unknown; reason?: unknown };
    const action = parseMemoryAction(args.action);
    const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : "(no reason)";
    const heading = action.section.startsWith("#") ? action.section : `## ${action.section}`;
    const lines: string[] = [`reason: ${reason}`, ""];
    if (action.kind === "append") {
      lines.push(`+ ${heading}`);
      for (const ln of action.body.split("\n")) lines.push(`  + ${ln}`);
    } else if (action.kind === "replace") {
      lines.push(`~ ${heading}`);
      for (const ln of action.body.split("\n")) lines.push(`  ${ln}`);
    } else {
      lines.push(`- ${heading}`);
      lines.push("  (removed)");
    }
    return lines.slice(0, 10).join("\n");
  } catch {
    return undefined;
  }
}