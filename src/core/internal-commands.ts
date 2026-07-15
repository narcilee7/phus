// src/core/internal-commands.ts
// Bub-style internal commands prefixed with "," (e.g. ,help ,skill name=foo).
//
// Parsing:
//   ,name                  - no args
//   ,name key=val          - kwargs
//   ,name pos1 pos2        - positional (after kwargs)
//   ,name k=v free text    - positional after kwargs
//
// Commands are registered globally. Plugins can add via ctx.registerInternalCommand.

import { logger } from "./logger.js";

export interface InternalCommandContext {
  args: Record<string, string>;
  positional: string[];
  /** Where the command was invoked (cli | tui). */
  surface: "cli" | "tui";
}

export interface InternalCommand {
  name: string;
  description: string;
  /** Example usage, e.g. "[n=5]" or "name=<n>". */
  usage?: string;
  /** Execute the command. Return a string to print, or null for silent success. */
  handler: (ctx: InternalCommandContext) => Promise<string | null>;
}

const registry = new Map<string, InternalCommand>();

/** Register an internal command. Throws if name already taken (use replace=true to override). */
export function register(cmd: InternalCommand, opts: { replace?: boolean } = {}): void {
  if (registry.has(cmd.name) && !opts.replace) {
    throw new Error(`Internal command "${cmd.name}" already registered`);
  }
  registry.set(cmd.name, cmd);
}

/** Unregister an internal command (used by /unregister or tests). */
export function unregister(name: string): boolean {
  return registry.delete(name);
}

/** List all registered commands. */
export function list(): InternalCommand[] {
  return [...registry.values()];
}

/** Look up a command by name. */
export function get(name: string): InternalCommand | undefined {
  return registry.get(name);
}

// ─── Parser ─────────────────────────────────────────────────────

/**
 * Parse a command line into name + args + positional.
 *
 * Examples:
 *   "help"                          → { name: "help", args: {}, positional: [] }
 *   "skill name=foo"                → { name: "skill", args: { name: "foo" }, positional: [] }
 *   "trace 10"                      → { name: "trace", args: {}, positional: ["10"] }
 *   "fs.write path=/tmp/x content=hi there"  → args + positional ["hi there"]
 */
export function parse(line: string): { name: string; args: Record<string, string>; positional: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(",")) return null;
  const body = trimmed.slice(1).trim();
  if (!body) return null;

  const tokens = tokenize(body);
  if (tokens.length === 0) return null;

  const name = tokens[0]!;
  const args: Record<string, string> = {};
  const positional: string[] = [];
  let kwargDone = false;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const eq = tok.indexOf("=");
    if (eq > 0 && !kwargDone) {
      const key = tok.slice(0, eq);
      const val = stripQuotes(tok.slice(eq + 1));
      args[key] = val;
    } else {
      kwargDone = true;
      positional.push(stripQuotes(tok));
    }
  }
  return { name, args, positional };
}

/** Tokenize respecting single/double-quoted strings. */
function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === " " && !inSingle && !inDouble) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ─── Execute ────────────────────────────────────────────────────

/**
 * Execute a command line. Returns the result string, or null if the line is not
 * an internal command (so the caller can fall through to AI chat).
 */
export async function execute(
  line: string,
  surface: "cli" | "tui" = "cli",
): Promise<string | null | "not-a-command"> {
  const parsed = parse(line);
  if (!parsed) return "not-a-command";
  const cmd = registry.get(parsed.name);
  if (!cmd) {
    return `unknown command: ,${parsed.name}. Try ,help.`;
  }
  try {
    const result = await cmd.handler({
      args: parsed.args,
      positional: parsed.positional,
      surface,
    });
    logger.debug("internal_command.executed", {
      name: parsed.name,
      surface,
      hasResult: result !== null,
    });
    return result;
  } catch (err: any) {
    logger.error("internal_command.failed", {
      name: parsed.name,
      error: err.message,
    });
    return `error in ,${parsed.name}: ${err.message ?? err}`;
  }
}

/** Render a help table for `,help`. */
export function renderHelp(): string {
  const cmds = list().sort((a, b) => a.name.localeCompare(b.name));
  const lines = ["internal commands (Bub-style, prefix ,):", ""];
  const maxName = Math.max(...cmds.map((c) => c.name.length));
  for (const c of cmds) {
    const usage = c.usage ? ` ${c.usage}` : "";
    lines.push(`  ,${c.name.padEnd(maxName)}${usage}  — ${c.description}`);
  }
  return lines.join("\n");
}

// ─── Built-ins ───────────────────────────────────────────────────
// Register the standard set on module load. Plugin commands are added via
// ctx.registerInternalCommand after this.

import * as fs from "node:fs/promises";
import * as pathMod from "node:path";

/** Register the built-in commands. Called once on module load. */
export function registerBuiltins(getAgent: () => any, getHome: () => string): void {
  // ,help
  register({
    name: "help",
    description: "list internal commands",
    handler: async () => renderHelp(),
  });

  // ,skills
  register({
    name: "skills",
    description: "list discovered skills",
    handler: async () => {
      const agent = getAgent();
      const list = agent._internal.skills.getAll();
      if (list.length === 0) return "(no skills loaded)";
      return list
        .map((s: any) => `  ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})  ${s.description}`)
        .join("\n");
    },
  });

  // ,skill name=<n>
  register({
    name: "skill",
    description: "print a skill's body",
    usage: "name=<skill-name>",
    handler: async ({ args }) => {
      const name = args.name;
      if (!name) return "usage: ,skill name=<name>";
      const skill = getAgent()._internal.skills.get(name);
      if (!skill) return `skill not found: ${name}`;
      return `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`;
    },
  });

  // ,tape
  register({
    name: "tape",
    description: "tape statistics",
    handler: async () => JSON.stringify(getAgent()._internal.tape.stats(), null, 2),
  });

  // ,trace [n=5]
  register({
    name: "trace",
    description: "show last n turns of current session",
    usage: "[n=5]",
    handler: async ({ args, surface }) => {
      const n = parseInt(args.n ?? "5", 10) || 5;
      const agent = getAgent();
      const sid = agent._currentSessionId ?? "default";
      const lines: string[] = [];
      const all = Array.from(agent._internal.tape.replay(sid)) as Array<{ kind: string; turn?: any }>;
      for (let i = all.length - 1; i >= 0 && lines.length < n; i--) {
        const e = all[i]!;
        if (e.kind === "turn" && e.turn) {
          const u = (e.turn.inbound.content ?? "").slice(0, 60).replace(/\n/g, " ");
          lines.push(`  [${new Date(e.turn.ts).toISOString().slice(11, 19)}] ${e.turn.inbound.from}: ${u}`);
        }
      }
      return lines.length ? lines.reverse().join("\n") : "(empty)";
    },
  });

  // ,sessions
  register({
    name: "sessions",
    description: "list sessions in tape",
    handler: async () => {
      const s = getAgent()._internal.tape.stats();
      const entries = Object.entries(s.sessions) as Array<[string, number]>;
      const lines = entries
        .sort((a, b) => b[1] - a[1])
        .map(([sid, n]) => `  ${sid}  (${n} entries)`);
      return lines.length ? lines.join("\n") : "(no sessions)";
    },
  });

  // ,use session=<id>
  register({
    name: "use",
    description: "switch the active session id for the next turn",
    usage: "session=<sessionId>",
    handler: async ({ args }) => {
      const sid = args.session;
      if (!sid) return "usage: ,use session=<id>";
      (getAgent() as any)._sessionOverride = sid;
      return `✓ next turn will use session: ${sid}`;
    },
  });

  // ,compact [keep=10]
  register({
    name: "compact",
    description: "compact current session, keeping the most recent N turns",
    usage: "[keep=10]",
    handler: async ({ args, surface }) => {
      const { compactSession } = await import("./compaction.js");
      const keep = parseInt(args.keep ?? "10", 10) || 10;
      const agent = getAgent() as any;
      const sid = agent._sessionOverride ?? agent._currentSessionId ?? "default";
      const r = await compactSession(agent._internal.tape, sid, { keepRecent: keep });
      return `compacted: summarized=${r.summarized}, kept=${r.keptRecent}`;
    },
  });

  // ,fs.read path=<p>
  register({
    name: "fs.read",
    description: "print a file's contents",
    usage: "path=<file>",
    handler: async ({ args }) => {
      const p = args.path;
      if (!p) return "usage: ,fs.read path=<file>";
      try {
        const content = await fs.readFile(p, "utf-8");
        return `── ${p} (${content.length} chars) ──\n${content}`;
      } catch (err: any) {
        return `read failed: ${err.message}`;
      }
    },
  });

  // ,fs.write path=<p> content=<text>
  register({
    name: "fs.write",
    description: "write a file (must be in policy root)",
    usage: "path=<file> content=<text>",
    handler: async ({ args }) => {
      const p = args.path;
      const content = args.content;
      if (!p || content === undefined) return "usage: ,fs.write path=<file> content=<text>";
      try {
        await fs.mkdir(pathMod.dirname(p), { recursive: true });
        await fs.writeFile(p, content, "utf-8");
        return `✓ wrote ${content.length} bytes to ${p}`;
      } catch (err: any) {
        return `write failed: ${err.message}`;
      }
    },
  });

  // ,reload
  register({
    name: "reload",
    description: "reload skills and plugins from disk",
    handler: async () => {
      const agent = getAgent();
      agent._internal.skills.discover();
      const { loadPlugins } = await import("./plugin.js");
      const channels: any[] = [];
      const loaded = loadPlugins(agent._internal.hooks, channels, {
        registerRuntime: () => {},
      });
      return `✓ reloaded: ${agent._internal.skills.getAll().length} skills, ${loaded.length} plugins`;
    },
  });

  // ,plugins
  register({
    name: "plugins",
    description: "list loaded plugins",
    handler: async () => {
      const { loadPlugins } = await import("./plugin.js");
      const hooks = getAgent()._internal.hooks;
      const channels: any[] = [];
      const loaded = loadPlugins(hooks, channels, { registerRuntime: () => {} });
      if (loaded.length === 0) return "(no plugins loaded)";
      return loaded.map((p: any) => `  ${p.status === "ok" ? "✓" : "✗"} ${p.name}  ${p.path}`).join("\n");
    },
  });

  // ,schedule list
  register({
    name: "schedule.list",
    description: "list all registered schedules",
    handler: async () => {
      const { getScheduler } = await import("./scheduler-runtime.js");
      const sched = getScheduler();
      if (!sched) return "(scheduler not initialized — only runs in gateway mode)";
      const list = sched.list();
      if (list.length === 0) return "(no schedules registered)";
      return list.map((s: any) =>
        `  ${s.enabled === false ? "○" : "●"} ${s.name.padEnd(24)} ${s.cron.padEnd(14)} → ${s.hookName}`,
      ).join("\n");
    },
  });

  // ,schedule.add name=foo cron="*/5 * * * *" hookName=system_prompt
  register({
    name: "schedule.add",
    description: "add a new schedule",
    usage: "name=<n> cron=\"<expr>\" hookName=<hook>",
    handler: async ({ args }) => {
      const name = args.name;
      const cron = args.cron;
      const hookName = args.hookName;
      if (!name || !cron || !hookName) {
        return "usage: ,schedule.add name=<n> cron=\"<expr>\" hookName=<hook>";
      }
      const { getScheduler } = await import("./scheduler-runtime.js");
      const sched = getScheduler();
      if (!sched) return "(scheduler not initialized — only runs in gateway mode)";
      try {
        sched.register({ name, cron, hookName: hookName as any, payload: args.payload ? JSON.parse(String(args.payload)) : undefined });
        return `✓ schedule "${name}" added (${cron})`;
      } catch (err: any) {
        return `failed: ${err.message}`;
      }
    },
  });

  // ,schedule.remove name=foo
  register({
    name: "schedule.remove",
    description: "remove a schedule",
    usage: "name=<n>",
    handler: async ({ args }) => {
      const name = args.name;
      if (!name) return "usage: ,schedule.remove name=<n>";
      const { getScheduler } = await import("./scheduler-runtime.js");
      const sched = getScheduler();
      if (!sched) return "(scheduler not initialized)";
      const ok = sched.unregister(name);
      return ok ? `✓ schedule "${name}" removed` : `not found: ${name}`;
    },
  });

  // ,schedule.enable name=foo / ,schedule.disable name=foo
  register({
    name: "schedule.enable",
    description: "enable a disabled schedule",
    usage: "name=<n>",
    handler: async ({ args }) => {
      const name = args.name;
      if (!name) return "usage: ,schedule.enable name=<n>";
      const { getScheduler } = await import("./scheduler-runtime.js");
      const sched = getScheduler();
      if (!sched) return "(scheduler not initialized)";
      return sched.setEnabled(name, true) ? `✓ enabled "${name}"` : `not found: ${name}`;
    },
  });

  register({
    name: "schedule.disable",
    description: "disable a schedule (keeps registration, stops firing)",
    usage: "name=<n>",
    handler: async ({ args }) => {
      const name = args.name;
      if (!name) return "usage: ,schedule.disable name=<n>";
      const { getScheduler } = await import("./scheduler-runtime.js");
      const sched = getScheduler();
      if (!sched) return "(scheduler not initialized)";
      return sched.setEnabled(name, false) ? `○ disabled "${name}"` : `not found: ${name}`;
    },
  });

  // Alias: ,schedule -> ,schedule.list
  register({
    name: "schedule",
    description: "alias for ,schedule.list",
    handler: async () => {
      const { execute } = await import("./internal-commands.js");
      const r = await execute(",schedule.list", "tui");
      return r === "not-a-command" ? null : r;
    },
  });

  // ,clear
  register({
    name: "clear",
    description: "clear the chat area (TUI) or stdout (CLI)",
    handler: async ({ surface }) => {
      // CLI: print ANSI clear + cursor home. TUI: caller handles via special return.
      if (surface === "cli") {
        process.stdout.write("\x1b[2J\x1b[H");
      }
      return surface === "tui" ? "__CLEAR_TUI__" : null;
    },
  });

  // ,quit
  register({
    name: "quit",
    description: "exit the REPL",
    handler: async ({ surface }) => {
      return surface === "tui" ? "__QUIT_TUI__" : null;
    },
  });

  // ,policy
  register({
    name: "policy",
    description: "show active safety policy",
    handler: async () => {
      const rules = getAgent()._internal.policy;
      return (
        `policy rules:\n${rules.map((r: any) => `  - ${r.toolName}`).join("\n")}\n\n` +
        `file_write roots: ./skills, ./.phus, ./tmp, ./out\n` +
        `bash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`
      );
    },
  });

  // ,context
  register({
    name: "context",
    description: "show system prompt + skills + tape summary that gets injected",
    handler: async () => {
      const agent = getAgent();
      const m = agent._internal.piAgent.state.model;
      const skills = agent._internal.skills.toPromptContext();
      const tapeSum = agent._internal.tape.summary(agent._currentSessionId ?? "default", 5);
      return [
        `model: ${m.provider}/${m.id}`,
        `thinking: ${agent._internal.piAgent.state.thinkingLevel}`,
        `messages: ${agent._internal.piAgent.state.messages.length}`,
        "",
        "── skills ──",
        skills || "(none)",
        "",
        "── recent tape ──",
        tapeSum || "(empty)",
      ].join("\n");
    },
  });
}

/** Initialize: register built-ins once. Idempotent. */
let initialized = false;
export function initInternalCommands(getAgent: () => any, getHome: () => string): void {
  if (initialized) return;
  initialized = true;
  registerBuiltins(getAgent, getHome);
}
