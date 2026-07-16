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
    () => new Set(["bash", "file_write", "startup_write", "skill_write", "skill_delete"]),
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
      return new Promise<boolean>((resolve) => {
        dispatch({
          type: "push_permission",
          request: {
            id: crypto.randomUUID(),
            toolName: req.toolName,
            args: req.args,
            toolCallId: req.toolCallId,
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