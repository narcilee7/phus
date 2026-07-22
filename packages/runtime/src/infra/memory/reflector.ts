// src/infra/memory/reflector.ts
// Post-turn auto-reflection.
//
// Runs at the end of every `turn()` and tries to extract one or more
// MemoryActions from the user prompt + assistant output + tool calls.
// The actions are routed through AutonomyGate — `yolo` and matching
// `autoApprove` rules commit them straight to phus.md, everything
// else is silently dropped (operators can run `self_reflect` to
// inspect what the reflector saw and `memory_write` manually).
//
// Heuristics only — this is NOT an LLM call. Goal is "cheap, fast,
// occasionally right" so a busy session doesn't burn money. A turn
// that *really* matters should be hand-noted via `memory_write`.
//
// The reflector never deletes or replaces — only `append`. Operators
// can collapse/clean up later.

import type { Turn } from "@phus/core/types/tape/index.js";
import type { MemoryAction, MemoryCategory } from "./store.js";

export interface ReflectorConfig {
  /** Hard kill switch. Default off. */
  enabled: boolean;
  /** Minimum combined length of (user prompt + model output) to bother
   *  reflecting on. Short turns (greetings, single-word answers) are
   *  noise that the agent already handles via in-session context. */
  minTurnLength: number;
  /** Hard cap on memory writes per turn — prevents one turn with
   *  many tool errors from spamming phus.md. */
  maxMemoriesPerTurn: number;
}

export const DEFAULT_REFLECTOR: ReflectorConfig = {
  enabled: false,
  minTurnLength: 240,
  maxMemoriesPerTurn: 2,
};

const URL_RE = /\bhttps?:\/\/[^\s)\]>"']+/g;

/** User-prompt keywords that signal "the user wants this remembered". */
const REMEMBER_TRIGGERS: readonly string[] = [
  "记住", "remember", "don't forget", "记下", "记一下", "备忘",
  "note:", "note that", "重要", "important",
  "决定", "decided", "we will use", "we'll use", "let's use",
  "always", "总是", "永远",
  "preference:", "preference ",
  "喜欢", "prefer",
];

/** Lines that look like a user-stated preference / decision. Captured
 *  whole-line so we don't lose context. */
function extractRememberedStatements(prompt: string): string[] {
  const out: string[] = [];
  for (const raw of prompt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (REMEMBER_TRIGGERS.some((k) => lower.includes(k.toLowerCase()))) {
      // Cap to keep memory entries useful — drop the "记住" prompt
      // framing and keep the substance.
      const cleaned = line
        .replace(/^(please\s+)?(remember|note|记住|记下|记一下|备忘|重要)[:：,。 ]*/i, "")
        .trim();
      if (cleaned.length > 4) out.push(cleaned);
    }
  }
  return out;
}

/** Unique URLs mentioned in either side of the conversation. Stored
 *  in `## External References` as `facts` so the next session can
 *  find them. */
function extractUrls(user: string, assistant: string): string[] {
  const found = new Set<string>();
  for (const m of (user + "\n" + assistant).matchAll(URL_RE)) {
    found.add(m[0]);
  }
  return [...found].slice(0, 4); // hard cap
}

/** Tool errors from the turn — if anything the agent called errored
 *  and the agent recovered, the failure mode is worth saving under
 *  `## Known Failures` so the next session avoids the same path. */
function extractFailures(turn: Turn): string[] {
  const out: string[] = [];
  for (const call of turn.toolCalls) {
    if (call.isError && call.name) {
      const reason =
        typeof call.result === "string"
          ? call.result.slice(0, 120)
          : "tool returned an error";
      out.push(`${call.name}: ${reason.replace(/\s+/g, " ")}`);
    }
  }
  return out.slice(0, 2);
}

export interface ReflectorResult {
  actions: MemoryAction[];
  /** Why each action was emitted — for the tape / diagnostics. */
  reasons: string[];
}

export class TurnReflector {
  constructor(private readonly cfg: ReflectorConfig = DEFAULT_REFLECTOR) {}

  /** Pure function over a `Turn` — no I/O, no clock. */
  reflect(turn: Turn): ReflectorResult {
    if (!this.cfg.enabled) return { actions: [], reasons: [] };
    const user = turn.prompt ?? "";
    const assistant = turn.modelOutput ?? "";
    if (user.length + assistant.length < this.cfg.minTurnLength) {
      return { actions: [], reasons: [] };
    }

    const actions: MemoryAction[] = [];
    const reasons: string[] = [];

    // 1. User-stated remember / decide / prefer statements.
    const remembered = extractRememberedStatements(user);
    if (remembered.length > 0) {
      actions.push({
        kind: "append",
        section: "## Notes",
        body: remembered.map((s) => `- ${s}`).join("\n"),
        category: "notes" satisfies MemoryCategory,
        authority: "user",
      });
      reasons.push(`user-stated remember (${remembered.length} line${remembered.length === 1 ? "" : "s"})`);
    }

    // 2. URLs mentioned in either side.
    const urls = extractUrls(user, assistant);
    if (urls.length > 0) {
      actions.push({
        kind: "append",
        section: "## External References",
        body: urls.map((u) => `- ${u}`).join("\n"),
        category: "facts" satisfies MemoryCategory,
        authority: "agent",
      });
      reasons.push(`urls (${urls.length})`);
    }

    // 3. Tool errors.
    const failures = extractFailures(turn);
    if (failures.length > 0) {
      actions.push({
        kind: "append",
        section: "## Known Failures",
        body: failures.map((f) => `- ${f}`).join("\n"),
        category: "failures" satisfies MemoryCategory,
        authority: "tape",
      });
      reasons.push(`tool errors (${failures.length})`);
    }

    return {
      actions: actions.slice(0, this.cfg.maxMemoriesPerTurn),
      reasons: reasons.slice(0, this.cfg.maxMemoriesPerTurn),
    };
  }
}