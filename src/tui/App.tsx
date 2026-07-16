// src/tui/App.tsx
// TUI root. Composes the layout components and dispatches events
// into the state reducer. All command dispatching lives in
// ./commands.ts; all event → action mapping in ./events.ts.

import React, { useEffect, useReducer } from "react";
import { Box, useApp, useInput } from "ink";
import type { PhusAgent } from "@/bridge/pi-agent.js";

import { appReducer, initialState } from "@/tui/state.js";
import { Header } from "@/tui/components/Header.js";
import { ChatViewport } from "@/tui/components/ChatViewport.js";
import { InputBox } from "@/tui/components/InputBox.js";
import { StatusBar } from "@/tui/components/StatusBar.js";
import { eventToAction } from "@/tui/events.js";
import { runSlash } from "@/tui/commands.js";
import { tuiChannel } from "@/tui/channel.js";

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
  modelLabel: string;
}

export function App({ agent, sessionId, modelLabel }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [input, setInput] = React.useState("");
  const [stats, setStats] = React.useState({ entries: 0, skills: 0, turns: 0 });

  // ─── Subscribe to Pi Agent events ─────────────────────────────
  useEffect(() => {
    const unsub = agent.subscribeToAgentEvents((event: any) => {
      const action = eventToAction(event);
      if (action) dispatch(action);
    });
    return unsub;
  }, [agent]);

  // ─── Live status tick (every 1.5s) ───────────────────────────
  useEffect(() => {
    const tick = () => {
      try {
        setStats({
          entries: agent.getTapeTotalEntries(),
          skills: agent.getSkillCount(),
          turns: agent.getMessageCount(),
        });
      } catch {
        /* ignore — agent may be mid-bootstrap */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [agent]);

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

    try {
      const envelope = {
        id: crypto.randomUUID(),
        from: "user",
        content: text,
        type: "text" as const,
        channel: "tui",
        metadata: { chatId: "tui" },
        ts: Date.now(),
      };
      await agent.turn(envelope, tuiChannel(dispatch));
    } catch (err: any) {
      dispatch({ type: "add_system", text: `error: ${err.message ?? err}`, level: "error" });
    } finally {
      dispatch({ type: "set_busy", busy: false });
      dispatch({ type: "set_last_op", op: "idle" });
    }
  };

  // ─── Ctrl+C / Ctrl+L shortcuts + scroll keys ──────────────────
  useInput((input, key) => {
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
  return (
    <Box flexDirection="column">
      <Header model={modelLabel} session={sessionId} stats={stats} lastOp={state.lastOp} />
      <ChatViewport
        items={state.items}
        busy={state.busy}
        scrollOffset={state.scroll.offset}
        hasNew={state.scroll.hasNew}
        lastOp={state.lastOp}
      />
      <InputBox
        value={input}
        busy={state.busy}
        showHint={state.showHint}
        onChange={setInput}
        onSubmit={submit}
      />
      <StatusBar modelLabel={modelLabel} skills={stats.skills} entries={stats.entries} />
    </Box>
  );
}