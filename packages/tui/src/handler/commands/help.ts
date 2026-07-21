// src/tui/handler/commands/help.ts
// Decorated command metadata (with grouping) and the help-screen
// renderer. Each entry maps a slash name to the human-readable section
// it appears under in /help.

import type { CommandRegistry } from "./context.js";
import type { CommandDispatch } from "./context.js";
import { notify } from "./notice.js";

export type CommandGroup = "runtime" | "memory" | "skills" | "exec" | "safety" | "control";

export interface SlashCommand {
  name: string;
  group: CommandGroup;
  description: string;
}

const COMMANDS: SlashCommand[] = [
  { name: "model", group: "runtime", description: "show or switch model (e.g. /model openai/gpt-4o)" },
  { name: "model-list", group: "runtime", description: "list known models" },
  { name: "reasoning", group: "runtime", description: "show or set: off | minimal | low | medium | high" },
  { name: "profiles", group: "runtime", description: "list provider profiles" },
  { name: "reload", group: "runtime", description: "reload plugins and skills from disk" },

  { name: "tape", group: "memory", description: "tape statistics" },
  { name: "trace", group: "memory", description: "last N turns (default 5)" },
  { name: "sessions", group: "memory", description: "list sessions in tape" },
  { name: "use", group: "memory", description: "switch active session" },
  { name: "compact", group: "memory", description: "compact, keep last N (default 10)" },
  { name: "context", group: "memory", description: "show system prompt + skills + tape summary" },
  { name: "forget", group: "memory", description: "clear conversation history (keeps tape)" },

  { name: "skills", group: "skills", description: "list skills" },
  { name: "skill-read", group: "skills", description: "read a skill body" },
  { name: "plugins", group: "skills", description: "list loaded plugins" },

  { name: "bash", group: "exec", description: "run shell without AI roundtrip" },
  { name: "read", group: "exec", description: "read a file" },

  { name: "policy", group: "safety", description: "show safety policy" },
  { name: "health", group: "safety", description: "run health check" },

  { name: "interrupt", group: "control", description: "abort the current turn" },
  { name: "undo", group: "control", description: "restore the last checkpoint for this session" },
  { name: "checkpoint", group: "control", description: "checkpoint management: list|create|restore <id>" },
  { name: "retry", group: "control", description: "retry last prompt" },
  { name: "plan", group: "control", description: "plan management: create|run|status|list|resume <args>" },
  { name: "subagent", group: "control", description: "show subagent sessions in sidebar" },
  { name: "new", group: "control", description: "start a fresh session" },
  { name: "clear", group: "control", description: "clear chat area" },
  { name: "quit", group: "control", description: "exit" },
  { name: "exit", group: "control", description: "exit" },
];

/** Flat list used by the input-box autocomplete and the palette. */
export const SLASH_COMMANDS: SlashCommand[] = COMMANDS;

const GROUP_TITLES: Record<CommandGroup, string> = {
  runtime: "Runtime",
  memory: "Memory",
  skills: "Skills & Plugins",
  exec: "Direct execution",
  safety: "Safety & health",
  control: "Control",
};

const GROUP_ORDER: CommandGroup[] = ["runtime", "memory", "skills", "exec", "safety", "control"];

function renderHelp(): string {
  const width = 18;
  const lines: string[] = [];
  for (const group of GROUP_ORDER) {
    const items = COMMANDS.filter((c) => c.group === group);
    if (items.length === 0) continue;
    lines.push(`── ${GROUP_TITLES[group]} ${"─".repeat(40 - GROUP_TITLES[group].length - 4)}`);
    for (const c of items) {
      lines.push(`  /${c.name.padEnd(width)} ${c.description}`);
    }
    lines.push("");
  }
  lines.push("── Navigation ────────────────────────────────────────");
  lines.push("  PgUp / PgDn         scroll chat history by page");
  lines.push("  Ctrl+↑ / Ctrl+↓     scroll chat history by line");
  lines.push("  Ctrl+End            jump to bottom");
  return lines.join("\n");
}

export function registerHelp(): CommandRegistry {
  return {
    help(_arg, { dispatch }: { dispatch: CommandDispatch }) {
      notify(dispatch, renderHelp());
    },
  };
}

/** Exposed for unit tests. */
export const HELP_TEXT = renderHelp();
