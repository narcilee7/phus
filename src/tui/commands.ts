// src/tui/commands.ts
// Slash command dispatcher — turns "/foo bar" into a state transition.
// Returns "quit" / "clear" to signal special exit, undefined to do nothing.

import type { PhusAgent } from "@/bridge/pi-agent.js";
import { asSessionId } from "@/types/brand.js";
import type { AppAction, AppState, SystemLevel } from "@/tui/state.js";

export type SlashResult = "quit" | "clear" | void;

const VALID_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

/** Dispatch a slash command. Mutates state via `dispatch`.
 *  Returns special signals ("quit", "clear") so the caller can
 *  exit the TUI or wipe the chat area. */
export async function runSlash(
  cmd: string,
  agent: PhusAgent,
  state: AppState,
  dispatch: (action: AppAction) => void,
): Promise<SlashResult> {
  const trimmed = cmd.trim();

  // Bub-style ,foo commands (also accepted in TUI).
  if (trimmed.startsWith(",")) {
    return runInternalCommand(trimmed, agent, dispatch);
  }

  if (!trimmed.startsWith("/")) return;

  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ");

  switch (name) {
    case "quit":
    case "exit":
      return "quit";

    case "help":
      dispatch({ type: "add_system", text: HELP_TEXT, level: "info" });
      return;

    case "model-list":
      return await cmdModelList(dispatch);

    case "model":
      return cmdModel(arg, agent, dispatch);

    case "reasoning":
      return cmdReasoning(arg, agent, dispatch);

    case "profiles":
      return await cmdProfiles(arg, agent, dispatch);

    case "reload":
      return await cmdReload(agent, dispatch);

    case "sessions":
      return cmdSessions(state, agent, dispatch);

    case "use":
      return cmdUse(arg, agent, dispatch);

    case "context":
      return cmdContext(agent, dispatch);

    case "forget":
      await agent.clearConversation();
      dispatch({ type: "add_system", text: "✓ conversation cleared (tape intact)", level: "info" });
      return;

    case "skill-read":
      return cmdSkillRead(arg, agent, dispatch);

    case "plugins":
      dispatch({
        type: "add_system",
        text: "plugin system: see `phus plugins-list` outside TUI\n(runtime plugin reload: /reload)",
        level: "info",
      });
      return;

    case "tasks":
      return await cmdTasks(dispatch);

    case "bash":
      return await cmdBash(arg, dispatch);

    case "read":
      return await cmdRead(arg, dispatch);

    case "interrupt":
      agent.interrupt();
      dispatch({ type: "add_system", text: "✓ current turn aborted", level: "warn" });
      return;

    case "retry":
      return cmdRetry(state, dispatch);

    case "new":
      await agent.clearConversation();
      dispatch({ type: "clear_items" });
      dispatch({ type: "add_system", text: `✓ fresh session started`, level: "info" });
      return;

    case "clear":
      return "clear";

    case "skills":
      return cmdSkills(agent, dispatch);

    case "tape":
      return cmdTape(agent, dispatch);

    case "trace":
      return cmdTrace(arg, agent, state, dispatch);

    case "compact":
      return await cmdCompact(agent, dispatch);

    case "policy":
      return cmdPolicy(agent, dispatch);

    case "health":
      return await cmdHealth(dispatch);

    default:
      dispatch({ type: "add_system", text: `unknown command: /${name}. Try /help.`, level: "warn" });
  }
}

const HELP_TEXT = [
  "── Runtime ──────────────────────────────────────────",
  "  /model [id]         show or switch model (e.g. /model openai/gpt-4o)",
  "  /model-list         list known models",
  "  /reasoning [level]  show or set: off | minimal | low | medium | high",
  "  /profiles           list provider profiles",
  "  /reload             reload plugins and skills from disk",
  "",
  "── Memory ───────────────────────────────────────────",
  "  /tape               tape statistics",
  "  /trace [N]          last N turns (default 5)",
  "  /sessions           list sessions in tape",
  "  /use <sessionId>    switch active session",
  "  /compact [N]        compact, keep last N (default 10)",
  "  /context            show system prompt + skills + tape summary",
  "  /forget             clear conversation history (keeps tape)",
  "",
  "── Skills & Plugins ─────────────────────────────────",
  "  /skills             list skills",
  "  /skill-read <name>  read a skill body",
  "  /plugins            list loaded plugins",
  "",
  "── Direct execution ─────────────────────────────────",
  "  /bash <cmd>         run shell without AI roundtrip",
  "  /read <path>        read a file",
  "",
  "── Safety & health ──────────────────────────────────",
  "  /policy             show safety policy",
  "  /health             run health check",
  "",
  "── Control ─────────────────────────────────────────",
  "  /interrupt          abort the current turn",
  "  /retry              retry last prompt",
  "  /new                start a fresh session",
  "  /clear              clear chat area",
  "  /quit               exit",
].join("\n");

// ─── Individual command handlers ──────────────────────────────────

async function runInternalCommand(
  line: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): Promise<SlashResult> {
  const { execute, initInternalCommands } = await import(
    "@/core/runtime/internal-commands/index.js"
  );
  initInternalCommands({
    agent,
    home: () => process.env.PHUS_HOME ?? "./.phus",
    mesh: agent.getMesh(),
  });
  const result = await execute(line, "tui");
  if (result === "__QUIT_TUI__") return "quit";
  if (result === "__CLEAR_TUI__") return "clear";
  if (result && result !== "not-a-command") {
    dispatch({ type: "add_system", text: result, level: "info" });
  }
  return;
}

async function cmdModelList(dispatch: (a: AppAction) => void): Promise<void> {
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
    dispatch({ type: "add_system", text: lines.join("\n"), level: "info" });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `model-list failed: ${err.message}`, level: "error" });
  }
}

function cmdModel(
  arg: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): void {
  const current = agent.getCurrentModel();
  if (!arg) {
    dispatch({
      type: "add_system",
      text: `current: ${current.provider}/${current.id}\nswitch: /model <provider>/<modelId>`,
      level: "info",
    });
    return;
  }
  const [provider, modelId] = arg.split("/", 2);
  if (!provider || !modelId) {
    dispatch({ type: "add_system", text: "usage: /model <provider>/<modelId>", level: "warn" });
    return;
  }
  try {
    agent.setModel(modelId, provider);
    dispatch({
      type: "add_system",
      text: `✓ model switched to ${provider}/${modelId}`,
      level: "info",
    });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `switch failed: ${err.message}`, level: "error" });
  }
}

function cmdReasoning(
  arg: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): void {
  if (!arg) {
    dispatch({
      type: "add_system",
      text: `current: ${agent.getThinkingLevel()}\nset: /reasoning <${VALID_LEVELS.join("|")}>`,
      level: "info",
    });
    return;
  }
  if (!VALID_LEVELS.includes(arg as typeof VALID_LEVELS[number])) {
    dispatch({
      type: "add_system",
      text: `invalid level. allowed: ${VALID_LEVELS.join(", ")}`,
      level: "warn",
    });
    return;
  }
  agent.setThinkingLevel(arg);
  dispatch({ type: "add_system", text: `✓ thinking level = ${arg}`, level: "info" });
}

async function cmdProfiles(
  arg: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): Promise<void> {
  const { formatProfiles, resolveProfile, modelFromProfile, loadProviderConfig } =
    await import("@/infra/profile.js");
  const activeName = process.env.PHUS_PROFILE ?? "(default)";
  if (!arg) {
    dispatch({
      type: "add_system",
      text: `── Provider profiles ──\n${formatProfiles()}\n\nactive: ${activeName}\nuse: /profiles <name>  to switch for next turn`,
      level: "info",
    });
    return;
  }
  try {
    const cfg = loadProviderConfig();
    resolveProfile(arg, cfg);
    process.env.PHUS_PROFILE = arg;
    const next = modelFromProfile(resolveProfile(arg, cfg));
    agent.setModel(next.id, next.provider);
    dispatch({
      type: "add_system",
      text: `✓ switched to profile: ${arg} (${next.provider}/${next.id})`,
      level: "info",
    });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `switch failed: ${err.message}`, level: "error" });
  }
}

async function cmdReload(
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): Promise<void> {
  try {
    const result = await agent.loadPluginsForReload([]);
    dispatch({
      type: "add_system",
      text: `✓ reloaded: ${result.skills} skills, ${result.plugins} plugins`,
      level: "info",
    });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `reload failed: ${err.message}`, level: "error" });
  }
}

function cmdSessions(
  _state: AppState,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): void {
  const s = agent.getTapeStats();
  const list = Object.entries(s.sessions)
    .sort((a, b) => b[1] - a[1])
    .map(([sid, n]) => `  ${sid}  (${n} entries)`)
    .join("\n");
  dispatch({
    type: "add_system",
    text: `sessions:\n${list || "(none)"}`,
    level: "info",
  });
}

function cmdUse(
  arg: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): void {
  if (!arg) {
    dispatch({ type: "add_system", text: "usage: /use <sessionId>", level: "warn" });
    return;
  }
  agent.setNextSessionId(asSessionId(arg));
  dispatch({
    type: "add_system",
    text: `✓ next turn will use session: ${arg}`,
    level: "info",
  });
}

function cmdContext(agent: PhusAgent, dispatch: (a: AppAction) => void): void {
  const m = agent.getCurrentModel();
  const skills = agent.getSkillsPrompt();
  const tapeSum = agent.getTapeSummary(agent.getCurrentSessionId(), 5);
  dispatch({
    type: "add_system",
    text: [
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
    level: "info",
  });
}

function cmdSkillRead(
  arg: string,
  agent: PhusAgent,
  dispatch: (a: AppAction) => void,
): void {
  if (!arg) {
    dispatch({ type: "add_system", text: "usage: /skill-read <name>", level: "warn" });
    return;
  }
  const skill = agent.getSkill(arg);
  if (!skill) {
    dispatch({ type: "add_system", text: `skill not found: ${arg}`, level: "warn" });
    return;
  }
  dispatch({
    type: "add_system",
    text: `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`,
    level: "info",
  });
}

async function cmdTasks(dispatch: (a: AppAction) => void): Promise<void> {
  const { collectTasks, renderTasks } = await import("@/commands/tasks.js");
  const out = await collectTasks();
  dispatch({ type: "add_system", text: renderTasks(out), level: "info" });
}

async function cmdBash(
  arg: string,
  dispatch: (a: AppAction) => void,
): Promise<void> {
  if (!arg) {
    dispatch({ type: "add_system", text: "usage: /bash <command>", level: "warn" });
    return;
  }
  dispatch({ type: "set_busy", busy: true });
  dispatch({ type: "set_last_op", op: "bash…" });
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileP = promisify(execFile);
    const out = await execFileP("sh", ["-c", arg], { timeout: 30_000 });
    dispatch({
      type: "add_system",
      text: `$ ${arg}\n${(out.stdout ?? "") + (out.stderr ?? "")}`.trimEnd(),
      level: "info",
    });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `bash failed: ${err.message}`, level: "error" });
  } finally {
    dispatch({ type: "set_busy", busy: false });
    dispatch({ type: "set_last_op", op: "idle" });
  }
}

async function cmdRead(arg: string, dispatch: (a: AppAction) => void): Promise<void> {
  if (!arg) {
    dispatch({ type: "add_system", text: "usage: /read <path>", level: "warn" });
    return;
  }
  try {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(arg, "utf-8");
    dispatch({
      type: "add_system",
      text: `── ${arg} (${text.length} chars) ──\n${text}`,
      level: "info",
    });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `read failed: ${err.message}`, level: "error" });
  }
}

function cmdRetry(state: AppState, dispatch: (a: AppAction) => void): void {
  const lastUser = [...state.items].reverse().find((it) => it.kind === "user");
  if (!lastUser?.text) {
    dispatch({ type: "add_system", text: "nothing to retry", level: "warn" });
    return;
  }
  // Caller (App.tsx) will pick this up via the items state; the input
  // field is owned by App. We push the user item a second time via
  // dispatch on the caller side; here we just notify.
  dispatch({
    type: "add_system",
    text: `(retry requested — press Enter to re-submit)`,
    level: "info",
  });
}

function cmdSkills(agent: PhusAgent, dispatch: (a: AppAction) => void): void {
  const list = agent.getAllSkills();
  if (list.length === 0) {
    dispatch({
      type: "add_system",
      text: "no skills loaded — ask the agent to write one with skill_write",
      level: "info",
    });
  } else {
    dispatch({
      type: "add_system",
      text: list
        .map((s) => `  ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})  ${s.description}`)
        .join("\n"),
      level: "info",
    });
  }
}

function cmdTape(agent: PhusAgent, dispatch: (a: AppAction) => void): void {
  dispatch({
    type: "add_system",
    text: JSON.stringify(agent.getTapeStats(), null, 2),
    level: "info",
  });
}

function cmdTrace(
  arg: string,
  agent: PhusAgent,
  _state: AppState,
  dispatch: (a: AppAction) => void,
): void {
  const n = parseInt(arg, 10) || 5;
  const lines: string[] = [];
  let count = 0;
  const all = Array.from(agent.replayTape(undefined));
  for (let i = all.length - 1; i >= 0 && count < n; i--, count++) {
    const e = all[i]!;
    if (e.kind === "turn") {
      const t = (e as any).turn;
      const u = (t.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
      lines.push(`  [${new Date(t.ts).toISOString().slice(11, 19)}] ${t.inbound.from}: ${u}`);
    }
  }
  dispatch({
    type: "add_system",
    text: lines.length ? lines.join("\n") : "(empty)",
    level: "info",
  });
}

async function cmdCompact(agent: PhusAgent, dispatch: (a: AppAction) => void): Promise<void> {
  const sid = agent.getCurrentSessionId();
  if (!sid) {
    dispatch({ type: "add_system", text: "no active session to compact", level: "warn" });
    return;
  }
  try {
    agent.setNextSessionId(sid);
    const out = await agent.compactCurrentSession();
    dispatch({ type: "add_system", text: out, level: "info" });
  } catch (err: any) {
    dispatch({ type: "add_system", text: `compact failed: ${err.message}`, level: "error" });
  }
}

function cmdPolicy(agent: PhusAgent, dispatch: (a: AppAction) => void): void {
  const rules = agent.getPolicy();
  dispatch({
    type: "add_system",
    text:
      `policy rules:\n${rules.map((r) => `  - ${r.toolName}`).join("\n")}\n\n` +
      `file_write roots: ./skills, ./.phus, ./tmp, ./out\n` +
      `bash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`,
    level: "info",
  });
}

async function cmdHealth(dispatch: (a: AppAction) => void): Promise<void> {
  const { healthCheck } = await import("@/commands/health.js");
  const h = healthCheck();
  dispatch({
    type: "add_system",
    text: JSON.stringify(h, null, 2),
    level: h.ok ? "info" : "warn",
  });
}