// src/tui/App.tsx
// Production-grade interactive TUI built on ink.
//
// Three-column layout:
//   ┌─ Header (model, session, turn count, live status) ──────────┐
//   │                                                              │
//   │  chat area (scrollable, last 100 items)                      │
//   │    user:    ❯ hello                                          │
//   │    tool:    ⏵ bash  {"command":"ls"}                         │
//   │              → ✓ 42ms · 3 lines                              │
//   │    asst:    ⛰ Hi there!  (streamed)                          │
//   │    sys:     ⚠ tool blocked by policy                         │
//   │                                                              │
//   ├─ Input ─────────────────────────────────────────────────────┤
//   │  ❯ type here...                                              │
//   └──────────────────────────────────────────────────────────────┘
//
// Slash commands: /help, /clear, /skills, /tape, /trace, /compact,
//                 /policy, /health, /quit

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import { asSessionId } from "@/types/brand.js";

interface ChatItem {
  id: string;
  kind: "user" | "assistant" | "tool_call" | "tool_result" | "system";
  ts: number;
  text?: string;
  isStreaming?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  level?: "info" | "warn" | "error";
}

interface AppProps {
  agent: PhusAgent;
  sessionId: string;
  modelLabel: string;
}

export function App({ agent, sessionId, modelLabel }: AppProps) {
  const { exit } = useApp();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [stats, setStats] = useState({ entries: 0, skills: 0, turns: 0 });
  const [lastOp, setLastOp] = useState<string>("idle");

  // ─── Subscribe to Pi Agent events ─────────────────────────────
  useEffect(() => {
    const unsub = agent.subscribeToAgentEvents((event: any) => {
      switch (event.type) {
        case "message_update": {
          const ame = event.assistantMessageEvent;
          if (ame?.type === "text_delta") {
            const delta: string = ame.delta ?? "";
            setItems((prev) => appendDelta(prev, delta));
          } else if (ame?.type === "thinking_delta") {
            // skip thinking display for now to avoid clutter
          }
          break;
        }
        case "tool_execution_start":
          setItems((prev) => upsertToolCall(prev, event));
          setLastOp(`tool: ${event.toolName}`);
          break;
        case "tool_execution_end":
          setItems((prev) => completeToolCall(prev, event));
          break;
        case "agent_end":
          setItems((prev) => finalizeStreaming(prev));
          setLastOp("idle");
          break;
        case "turn_end":
          if (event.message?.errorMessage) {
            setItems((prev) => [
              ...prev,
              makeSystem(`error: ${event.message.errorMessage}`, "error"),
            ]);
          }
          break;
      }
    });
    return unsub;
  }, [agent]);

  // ─── Live status tick ──────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      try {
        const entries = agent.getTapeTotalEntries();
        const skills = agent.getSkillCount();
        const turns = agent.getMessageCount();
        setStats({ entries, skills, turns });
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [agent]);

  // ─── Slash commands ────────────────────────────────────────────
  const runSlash = async (cmd: string): Promise<"quit" | "clear" | void> => {
    const trimmed = cmd.trim();
    // Bub-style ,foo commands (also accepted in TUI)
    if (trimmed.startsWith(",")) {
      const { execute, initInternalCommands } = await import("@/core/runtime/internal-commands/index.js");
      initInternalCommands({
        agent,
        home: () => process.env.PHUS_HOME ?? "./.phus",
        mesh: agent.getMesh(),
      });
      const result = await execute(trimmed, "tui");
      if (result === "__QUIT_TUI__") return "quit";
      if (result === "__CLEAR_TUI__") {
        setItems([]);
        return;
      }
      if (result && result !== "not-a-command") {
        setItems((prev) => [...prev, makeSystem(result, "info")]);
      }
      return;
    }
    if (!trimmed.startsWith("/")) return;
    const [name, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(" ");

    switch (name) {
      case "quit":
      case "exit":
        return "quit";

      case "help":
        setItems((prev) => [
          ...prev,
          makeSystem(
            [
              "── Runtime ──────────────────────────────────────",
              "  /model [id]         show or switch model (e.g. /model openai/gpt-4o)",
              "  /model-list         list known models",
              "  /reasoning [level]  show or set: off | minimal | low | medium | high",
              "  /profiles           list provider profiles",
              "  /reload             reload plugins and skills from disk",
              "",
              "── Memory ───────────────────────────────────────",
              "  /tape               tape statistics",
              "  /trace [N]          last N turns (default 5)",
              "  /sessions           list sessions in tape",
              "  /use <sessionId>    switch active session",
              "  /compact [N]        compact, keep last N (default 10)",
              "  /context            show system prompt + skills + tape summary",
              "  /forget             clear conversation history (keeps tape)",
              "",
              "── Skills & Plugins ─────────────────────────────",
              "  /skills             list skills",
              "  /skill-read <name>  read a skill body",
              "  /plugins            list loaded plugins",
              "",
              "── Direct execution ─────────────────────────────",
              "  /bash <cmd>         run shell without AI roundtrip",
              "  /read <path>        read a file",
              "",
              "── Safety & health ──────────────────────────────",
              "  /policy             show safety policy",
              "  /health             run health check",
              "",
              "── Control ──────────────────────────────────────",
              "  /interrupt          abort the current turn",
              "  /retry              retry last prompt",
              "  /new                start a fresh session",
              "  /clear              clear chat area",
              "  /quit               exit",
            ].join("\n"),
            "info",
          ),
        ]);
        return;

      case "model-list": {
        try {
          const { getProviders, getModels } = await import("@mariozechner/pi-ai");
          const lines: string[] = [];
          for (const p of getProviders()) {
            const models = getModels(p as any);
            lines.push(`  ${p}:`);
            for (const m of models.slice(0, 8)) {
              lines.push(`    - ${m.id}`);
            }
            if (models.length > 8) lines.push(`    ... +${models.length - 8} more`);
          }
          setItems((prev) => [...prev, makeSystem(lines.join("\n"), "info")]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`model-list failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "model": {
        const current = agent.getCurrentModel();
        if (!arg) {
          setItems((prev) => [
            ...prev,
            makeSystem(`current: ${current.provider}/${current.id}\nswitch: /model <provider>/<modelId>`, "info"),
          ]);
          return;
        }
        const [provider, modelId] = arg.split("/", 2);
        if (!provider || !modelId) {
          setItems((prev) => [...prev, makeSystem("usage: /model <provider>/<modelId>", "warn")]);
          return;
        }
        try {
          const { getModel } = await import("@mariozechner/pi-ai");
          const next = getModel(provider as any, modelId as any);
          agent.setModel(next.id, next.provider);
          setItems((prev) => [
            ...prev,
            makeSystem(`✓ model switched to ${next.provider}/${next.id}`, "info"),
          ]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`switch failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "reasoning": {
        const valid = ["off", "minimal", "low", "medium", "high"];
        if (!arg) {
          const cur = agent.getThinkingLevel();
          setItems((prev) => [
            ...prev,
            makeSystem(`current: ${cur}\nset: /reasoning <${valid.join("|")}>`, "info"),
          ]);
          return;
        }
        if (!valid.includes(arg)) {
          setItems((prev) => [
            ...prev,
            makeSystem(`invalid level. allowed: ${valid.join(", ")}`, "warn"),
          ]);
          return;
        }
        agent.setThinkingLevel(arg);
        setItems((prev) => [...prev, makeSystem(`✓ thinking level = ${arg}`, "info")]);
        return;
      }

      case "profiles": {
        const { formatProfiles, resolveProfile, modelFromProfile, loadProviderConfig } =
          await import("@/core/llm/profile.js");
        const activeName = process.env.PHUS_PROFILE ?? "(default)";
        if (!arg) {
          setItems((prev) => [
            ...prev,
            makeSystem(
              `── Provider profiles ──\n${formatProfiles()}\n\nactive: ${activeName}\nuse: /profiles <name>  to switch for next turn`,
              "info",
            ),
          ]);
          return;
        }
        try {
          const cfg = loadProviderConfig();
          resolveProfile(arg, cfg);
          process.env.PHUS_PROFILE = arg;
          // Switch the live agent too
          const next = modelFromProfile(resolveProfile(arg, cfg));
          agent.setModel(next.id, next.provider);
          setItems((prev) => [
            ...prev,
            makeSystem(`✓ switched to profile: ${arg} (${next.provider}/${next.id})`, "info"),
          ]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`switch failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "reload": {
        try {
          const result = await agent.loadPluginsForReload([]);
          setItems((prev) => [
            ...prev,
            makeSystem(
              `✓ reloaded: ${result.skills} skills, ${result.plugins} plugins`,
              "info",
            ),
          ]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`reload failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "sessions": {
        const s = agent.getTapeStats();
        const list = Object.entries(s.sessions)
          .sort((a, b) => b[1] - a[1])
          .map(([sid, n]) => `  ${sid}  (${n} entries)${sid === sessionId ? "  ← current" : ""}`)
          .join("\n");
        setItems((prev) => [
          ...prev,
          makeSystem(`sessions:\n${list || "(none)"}`, "info"),
        ]);
        return;
      }

      case "use": {
        if (!arg) {
          setItems((prev) => [...prev, makeSystem("usage: /use <sessionId>", "warn")]);
          return;
        }
        // Switch sessionId at runtime — the agent's piAgent.sessionId is set per turn
        // but we expose the override via the items header; actual switch on next turn.
        (agent as any)._sessionOverride = arg;
        setItems((prev) => [
          ...prev,
          makeSystem(`✓ next turn will use session: ${arg}`, "info"),
        ]);
        return;
      }

      case "context": {
        const m = agent.getCurrentModel();
        const skills = agent.getSkillsPrompt();
        const tapeSum = agent.getTapeSummary(agent.getCurrentSessionId(), 5);
        setItems((prev) => [
          ...prev,
          makeSystem(
            [
              `model: ${m.provider}/${m.id}`,
              `thinking: ${agent.getThinkingLevel()}`,
              `messages: ${agent.getMessageCount()}`,
              "",
              "── skills ──",
              skills || "(none)",
              "",
              "── recent tape ──",
              tapeSum || "(empty)",
            ].join("\n"),
            "info",
          ),
        ]);
        return;
      }

      case "forget": {
        await agent.clearConversation();
        setItems((prev) => [
          ...prev,
          makeSystem("✓ conversation cleared (tape intact)", "info"),
        ]);
        return;
      }

      case "skill-read": {
        if (!arg) {
          setItems((prev) => [...prev, makeSystem("usage: /skill-read <name>", "warn")]);
          return;
        }
        const skill = agent.getSkill(arg);
        if (!skill) {
          setItems((prev) => [...prev, makeSystem(`skill not found: ${arg}`, "warn")]);
          return;
        }
        setItems((prev) => [
          ...prev,
          makeSystem(
            `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`,
            "info",
          ),
        ]);
        return;
      }

      case "plugins": {
        setItems((prev) => [
          ...prev,
          makeSystem(
            "plugin system: see `phus plugins-list` outside TUI\n(runtime plugin reload: /reload)",
            "info",
          ),
        ]);
        return;
      }

      case "tasks": {
        const { collectTasks, renderTasks } = await import("@/commands/tasks.js");
        const out = await collectTasks();
        setItems((prev) => [...prev, makeSystem(renderTasks(out), "info")]);
        return;
      }

      case "bash": {
        if (!arg) {
          setItems((prev) => [...prev, makeSystem("usage: /bash <command>", "warn")]);
          return;
        }
        setBusy(true);
        setLastOp("bash…");
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileP = promisify(execFile);
          const out = await execFileP("sh", ["-c", arg], { timeout: 30_000 });
          setItems((prev) => [
            ...prev,
            makeSystem(`$ ${arg}\n${(out.stdout ?? "") + (out.stderr ?? "")}`.trimEnd(), "info"),
          ]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`bash failed: ${err.message}`, "error")]);
        } finally {
          setBusy(false);
          setLastOp("idle");
        }
        return;
      }

      case "read": {
        if (!arg) {
          setItems((prev) => [...prev, makeSystem("usage: /read <path>", "warn")]);
          return;
        }
        try {
          const fs = await import("node:fs/promises");
          const text = await fs.readFile(arg, "utf-8");
          setItems((prev) => [
            ...prev,
            makeSystem(`── ${arg} (${text.length} chars) ──\n${text}`, "info"),
          ]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`read failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "interrupt":
        agent.interrupt();
        setItems((prev) => [...prev, makeSystem("✓ current turn aborted", "warn")]);
        return;

      case "retry": {
        const lastUser = [...items].reverse().find((it) => it.kind === "user");
        if (!lastUser?.text) {
          setItems((prev) => [...prev, makeSystem("nothing to retry", "warn")]);
          return;
        }
        // re-submit by calling submit() programmatically
        setInput(lastUser.text);
        return;
      }

      case "new": {
        await agent.clearConversation();
        setItems([]);
        setItems((prev) => [
          ...prev,
          makeSystem(`✓ fresh session started (id: ${sessionId})`, "info"),
        ]);
        return;
      }

      case "clear":
        setItems([]);
        return;

      case "skills": {
        const list = agent.getAllSkills();
        if (list.length === 0) {
          setItems((prev) => [...prev, makeSystem("no skills loaded — ask the agent to write one with skill_write", "info")]);
        } else {
          setItems((prev) => [
            ...prev,
            makeSystem(
              list.map((s) => `  ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})  ${s.description}`).join("\n"),
              "info",
            ),
          ]);
        }
        return;
      }

      case "tape": {
        const s = agent.getTapeStats();
        setItems((prev) => [...prev, makeSystem(JSON.stringify(s, null, 2), "info")]);
        return;
      }

      case "trace": {
        const n = parseInt(arg, 10) || 5;
        const lines: string[] = [];
        let count = 0;
        const all = Array.from(agent.replayTape(sessionId));
        for (let i = all.length - 1; i >= 0 && count < n; i--, count++) {
          const e = all[i]!;
          if (e.kind === "turn") {
            const u = (e.turn.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
            lines.push(`  [${new Date(e.turn.ts).toISOString().slice(11, 19)}] ${e.turn.inbound.from}: ${u}`);
          }
        }
        setItems((prev) => [...prev, makeSystem(lines.length ? lines.join("\n") : "(empty)", "info")]);
        return;
      }

      case "compact": {
        try {
          const sid = agent.getCurrentSessionId();
          if (!sid) {
            setItems((prev) => [...prev, makeSystem("no active session to compact", "warn")]);
            return;
          }
          agent.setNextSessionId(sid);
          const out = await agent.compactCurrentSession();
          setItems((prev) => [...prev, makeSystem(out, "info")]);
        } catch (err: any) {
          setItems((prev) => [...prev, makeSystem(`compact failed: ${err.message}`, "error")]);
        }
        return;
      }

      case "policy": {
        const rules = agent.getPolicy();
        setItems((prev) => [
          ...prev,
          makeSystem(
            `policy rules:\n${rules.map((r) => `  - ${r.toolName}`).join("\n")}\n\nfile_write roots: ./skills, ./.phus, ./tmp, ./out\nbash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`,
            "info",
          ),
        ]);
        return;
      }

      case "health": {
        const { healthCheck } = await import("@/commands/health.js");
        const h = healthCheck();
        setItems((prev) => [
          ...prev,
          makeSystem(JSON.stringify(h, null, 2), h.ok ? "info" : "warn"),
        ]);
        return;
      }

      default:
        setItems((prev) => [...prev, makeSystem(`unknown command: /${name}. Try /help.`, "warn")]);
    }
  };

  // ─── Submit (Enter) ────────────────────────────────────────────
  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    setShowHint(false);

    if (text.startsWith("/")) {
      const result = await runSlash(text);
      if (result === "quit") exit();
      return;
    }

    setBusy(true);
    setLastOp("thinking…");
    setItems((prev) => [...prev, { id: crypto.randomUUID(), kind: "user", text, ts: Date.now() }]);

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
      await agent.turn(envelope, tuiChannel(setItems));
    } catch (err: any) {
      setItems((prev) => [...prev, makeSystem(`error: ${err.message ?? err}`, "error")]);
    } finally {
      setBusy(false);
      setLastOp("idle");
    }
  };

  // ─── Ctrl+C / Ctrl+L shortcuts ────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (busy) {
        agent.abort();
        setBusy(false);
        setLastOp("idle");
        setItems((prev) => [...prev, makeSystem("✓ aborted by user", "warn")]);
      } else {
        exit();
      }
    }
    if (key.ctrl && input === "l") setItems([]);
  });

  // ─── Render ────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      <Header model={modelLabel} session={sessionId} stats={stats} lastOp={lastOp} />
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} minHeight={20}>
        {items.slice(-100).map((it) => (
          <Item key={it.id} item={it} />
        ))}
        {busy && (
          <Text dimColor>
            <Text color="cyan">⛰  </Text>
            <Spinner /> thinking…
          </Text>
        )}
      </Box>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{busy ? "· " : "❯ "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder={showHint ? "type a message, or /help for commands" : ""}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {modelLabel} · {stats.skills} skills · {stats.entries} tape entries · Ctrl+C quit · Ctrl+L clear
        </Text>
      </Box>
    </Box>
  );
}

// ─── Header ─────────────────────────────────────────────────────
function Header({
  model,
  session,
  stats,
  lastOp,
}: {
  model: string;
  session: string;
  stats: { entries: number; skills: number; turns: number };
  lastOp: string;
}) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box>
        <Text bold color="cyan">⛰  Phus</Text>
        <Text>  ·  </Text>
        <Text>{model}</Text>
      </Box>
      <Text dimColor>
        session={session} · {stats.skills} skills · {stats.entries} tape entries · {lastOp}
      </Text>
    </Box>
  );
}

// ─── Item renderer ──────────────────────────────────────────────
function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Text>
          <Text color="green">❯ </Text>
          <Text color="green">{item.text}</Text>
        </Text>
      );

    case "assistant":
      return (
        <Text wrap="wrap">
          <Text color="cyan">⛰  </Text>
          {item.text}
          {item.isStreaming && <Text color="cyan">▍</Text>}
        </Text>
      );

    case "tool_call": {
      const args = truncate(JSON.stringify(item.args ?? {}), 60);
      return (
        <Text wrap="wrap">
          <Text color="yellow">⏵ </Text>
          <Text color="yellow">{item.toolName}</Text>
          <Text dimColor> {args}</Text>
          {item.isError === undefined && <Text dimColor>  (running…)</Text>}
        </Text>
      );
    }

    case "tool_result":
      return (
        <Text wrap="wrap">
          <Text>  </Text>
          {item.isError ? <Text color="red">✗ error</Text> : <Text color="green">✓ ok</Text>}
          {item.durationMs !== undefined && <Text dimColor>  {item.durationMs}ms</Text>}
          <Text dimColor>  {truncate(JSON.stringify(item.result ?? ""), 80)}</Text>
        </Text>
      );

    case "system":
      return (
        <Text wrap="wrap">
          <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : "gray"}>
            {item.level === "error" ? "⚠ " : "· "}
            {item.text}
          </Text>
        </Text>
      );
  }
}

// ─── Spinner ────────────────────────────────────────────────────
function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % 4), 120);
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{["⠋", "⠙", "⠹", "⠸"][frame]}</Text>;
}

// ─── Item manipulation helpers ──────────────────────────────────
function makeSystem(text: string, level: "info" | "warn" | "error" = "info"): ChatItem {
  return { id: crypto.randomUUID(), kind: "system", text, ts: Date.now(), level };
}

function appendDelta(prev: ChatItem[], delta: string): ChatItem[] {
  if (!delta) return prev;
  const last = prev[prev.length - 1];
  // Append to streaming assistant if the last item is one
  if (last && last.kind === "assistant" && last.isStreaming) {
    return [
      ...prev.slice(0, -1),
      { ...last, text: (last.text ?? "") + delta },
    ];
  }
  // Otherwise start a new streaming assistant message
  return [
    ...prev,
    { id: crypto.randomUUID(), kind: "assistant", ts: Date.now(), text: delta, isStreaming: true },
  ];
}

function finalizeStreaming(prev: ChatItem[]): ChatItem[] {
  return prev.map((it) =>
    it.kind === "assistant" && it.isStreaming ? { ...it, isStreaming: false } : it,
  );
}

function upsertToolCall(prev: ChatItem[], event: any): ChatItem[] {
  const id = event.toolCallId;
  const existing = prev.find((it) => it.kind === "tool_call" && it.toolCallId === id);
  const call: ChatItem = {
    id: crypto.randomUUID(),
    kind: "tool_call",
    ts: Date.now(),
    toolName: event.toolName,
    toolCallId: id,
    args: event.args,
  };
  if (existing) {
    return prev.map((it) => (it.id === existing.id ? { ...it, args: event.args } : it));
  }
  return [...prev, call];
}

function completeToolCall(prev: ChatItem[], event: any): ChatItem[] {
  const callId = event.toolCallId;
  const callIdx = prev.findIndex((it) => it.kind === "tool_call" && it.toolCallId === callId);
  if (callIdx === -1) return prev;
  const call = prev[callIdx]!;
  const result: ChatItem = {
    id: crypto.randomUUID(),
    kind: "tool_result",
    ts: Date.now(),
    toolCallId: callId,
    toolName: call.toolName,
    result: event.result,
    isError: !!event.isError,
  };
  // Mark original call as completed and append result below it.
  const updated = [...prev];
  updated[callIdx] = { ...call, isError: event.isError };
  updated.splice(callIdx + 1, 0, result);
  return updated;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ─── Channel adapter for TUI ─────────────────────────────────────
// The TUI is the source of truth for display: subscribe() handles
// streaming and tool events, channel.send() is a no-op (the final
// assistant text is already shown via streaming).
function tuiChannel(
  setItems: React.Dispatch<React.SetStateAction<ChatItem[]>>,
): { name: string; listen: () => void; send: (outbounds: any[]) => Promise<void> } {
  return {
    name: "tui",
    listen() {
      /* no-op */
    },
    async send(outbounds) {
      // Final consolidated outbound — only append if not already shown.
      for (const o of outbounds) {
        if (o.type === "text" && o.content) {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === "assistant" && last.text === o.content) {
              // Already shown via streaming — just mark complete
              return prev.map((it) =>
                it === last ? { ...it, isStreaming: false } : it,
              );
            }
            if (last?.kind === "assistant" && last.isStreaming) {
              // Append the final outbound to the streaming message
              return prev.map((it) =>
                it === last
                  ? { ...it, text: (it.text ?? "") + o.content, isStreaming: false }
                  : it,
              );
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                kind: "assistant" as const,
                ts: Date.now(),
                text: o.content,
              },
            ];
          });
        }
      }
    },
  };
}
