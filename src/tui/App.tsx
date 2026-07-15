// src/tui/App.tsx
// Interactive TUI built on ink (React for terminal).
// Three panes: messages (with streaming), skills + tape status, input.
//
// Slash commands:
//   /skills            — list skills
//   /tape              — tape stats
//   /trace <session>   — last 10 entries
//   /compact           — compact current session
//   /help              — show commands
//   /quit              — exit

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PhusAgent } from "../bridge/pi-agent.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
}

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
}

export function App({ agent, sessionId }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Subscribe to Pi Agent events for streaming text.
  useEffect(() => {
    const unsub = agent._internal.piAgent.subscribe((event: any) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const delta: string = event.assistantMessageEvent.delta ?? "";
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && Date.now() - last.ts < 1500) {
            return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
          }
          return [...prev, { role: "assistant", text: delta, ts: Date.now() }];
        });
      }
    });
    return unsub;
  }, [agent]);

  // Periodic status update.
  useEffect(() => {
    const tick = () => {
      try {
        const stats = agent._internal.tape.stats();
        const skillCount = agent._internal.skills.getAll().length;
        setStatusLine(`session=${sessionId}  skills=${skillCount}  tape=${stats.totalEntries} entries`);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [agent, sessionId]);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");

    if (text.startsWith("/")) {
      const handled = await handleSlash(text, agent, sessionId, setStatusLine, () => setMessages([]));
      if (handled === "quit") exit();
      return;
    }

    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", text, ts: Date.now() }]);
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
      await agent.turn(envelope, tuiChannel(setMessages));
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "system", text: `error: ${err.message}`, ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">⛰️  Phus TUI</Text>
        <Text dimColor>{statusLine}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minHeight={20}>
        {messages.slice(-30).map((m, i) => (
          <Text key={`${m.ts}-${i}`} color={m.role === "user" ? "green" : m.role === "system" ? "red" : "white"}>
            {m.role === "user" ? "❯ " : m.role === "system" ? "⚠ " : "⛰  "}
            {m.text}
          </Text>
        ))}
        {busy && <Text dimColor>⛰  thinking…</Text>}
      </Box>
      <Box>
        <Text color="cyan">{busy ? "  " : "❯ "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="type a message or /help" />
      </Box>
    </Box>
  );
}

async function handleSlash(
  cmd: string,
  agent: PhusAgent,
  sessionId: string,
  setStatus: (s: string) => void,
  clear: () => void,
): Promise<"quit" | "ok" | undefined> {
  const [name, ...rest] = cmd.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  switch (name) {
    case "quit":
    case "exit":
      return "quit";
    case "help":
      setStatus("commands: /skills /tape /trace <s> /compact /clear /help /quit");
      return "ok";
    case "clear":
      clear();
      return "ok";
    case "skills": {
      const list = agent._internal.skills.getAll().map((s) => `${s.name} (v${s.metadata.version ?? "?"})`).join(", ");
      setStatus(`skills: ${list || "(none)"}`);
      return "ok";
    }
    case "tape": {
      const stats = agent._internal.tape.stats();
      setStatus(`tape: ${JSON.stringify(stats)}`);
      return "ok";
    }
    case "trace": {
      const sid = arg || sessionId;
      const lines: string[] = [];
      for (const e of agent._internal.tape.replay(sid)) {
        if (e.kind === "turn") {
          lines.push(`[${new Date(e.turn.ts).toISOString().slice(11, 19)}] ${e.turn.inbound.from}: ${e.turn.inbound.content.slice(0, 60)}`);
        }
      }
      setStatus(`trace ${sid}: ${lines.slice(-5).join(" | ") || "(empty)"}`);
      return "ok";
    }
    case "compact": {
      const { compactSession } = await import("../core/compaction.js");
      const r = await compactSession(agent._internal.tape, sessionId, { keepRecent: 10 });
      setStatus(`compacted: summarized=${r.summarized} kept=${r.keptRecent}`);
      return "ok";
    }
    default:
      setStatus(`unknown command: /${name}. Try /help.`);
      return "ok";
  }
}

// Minimal ChannelAdapter for TUI: appends assistant text into the chat log.
function tuiChannel(setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>) {
  return {
    name: "tui",
    listen() { /* no-op: TUI pushes directly via submit() */ },
    async send(outbounds: any[]) {
      for (const o of outbounds) {
        if (o.type === "text" && o.content) {
          setMessages((prev) => [...prev, { role: "assistant", text: o.content, ts: Date.now() }]);
        }
      }
    },
  };
}
