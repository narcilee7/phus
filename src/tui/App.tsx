// src/tui/App.tsx
// TUI root. Composes the layout components and dispatches events
// into the state reducer. All command dispatching lives in
// ./commands.ts; all event → action mapping in ./events.ts.

import React, { useEffect, useReducer, useRef } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import { readFile } from "node:fs/promises";
import type { PhusAgent } from "@/bridge/pi-agent.js";

import { appReducer, initialState } from "@/tui/state.js";
import { Header } from "@/tui/components/Header.js";
import { ChatViewport } from "@/tui/components/ChatViewport.js";
import { TodoPill } from "@/tui/components/TodoPill.js";
import { InputBox } from "@/tui/components/InputBox.js";
import { PermissionBar } from "@/tui/components/PermissionBar.js";
import { CommandPalette, type PaletteAction } from "@/tui/components/CommandPalette.js";
import { StatusBar } from "@/tui/components/StatusBar.js";
import { FileTree } from "@/tui/components/FileTree.js";
import { eventToAction } from "@/tui/events.js";
import { runSlash } from "@/tui/commands.js";
import { tuiChannel } from "@/tui/channel.js";
import type { RememberChoice } from "@/tui/state.js";
import { extractMentions, readFileMention, buildContextBlock } from "@/tui/mentions.js";
import { parseMemoryAction } from "@/infra/meta/memory-tools.js";

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
  modelLabel: string;
}

export function App({ agent, sessionId, modelLabel }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [input, setInput] = React.useState("");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
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
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = React.useState(stdout.rows);

  const DANGEROUS_TOOLS = React.useMemo(
    () => new Set(["bash", "file_write", "startup_write", "skill_write", "skill_delete", "memory_write"]),
    [],
  );

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
    if (key.pageUp) {
      dispatch({ type: "scroll_up", lines: 5 });
    }
    if (key.pageDown) {
      dispatch({ type: "scroll_down", lines: 5 });
    }
    if (key.ctrl && key.end) {
      dispatch({ type: "scroll_bottom" });
    }
  });

  // ─── Render ───────────────────────────────────────────────────
  const sidebarHeight = Math.max(10, terminalRows - 6);
  return (
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
              height="100%"
            />
          </Box>
          <TodoPill items={state.items} busy={state.busy} lastOp={state.lastOp} />
          {state.permissionQueue[0] && !paletteOpen && !sidebarOpen && (
            <PermissionBar
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
          <StatusBar modelLabel={modelLabel} skills={stats.skills} entries={stats.entries} />
          <InputBox
            value={input}
            busy={state.busy}
            showHint={state.showHint}
            onChange={setInput}
            onSubmit={submit}
            isActive={state.permissionQueue.length === 0 && !paletteOpen && !sidebarOpen}
            mentions={extractMentions(input)
              .filter((m) => m.type === "file")
              .map((m) => ({ path: m.target, size: 0 }))}
          />
        </Box>
      </Box>
    </Box>
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