// src/core/auto-compact.ts
// Automatic tape compaction triggered by context size / token estimate.
//
// Wired into `before_llm_call` hook so it fires before every LLM call.

import type { Tape } from "./tape.js";
import { compactSession } from "./compaction.js";
import { logger } from "../infra/logging.js";
import type { SessionId } from "../types/brand.js";
import { asSessionId } from "../types/brand.js";

export interface AutoCompactConfig {
  /** Max number of messages before triggering. Default: 100. */
  maxMessages: number;
  /** Fraction of context window at which to trigger. Default: 0.7. */
  maxContextFraction: number;
  /** Compact down to this many recent turns. Default: 10. */
  keepRecent: number;
}

export const DEFAULT_AUTO_COMPACT: AutoCompactConfig = {
  maxMessages: 100,
  maxContextFraction: 0.7,
  keepRecent: 10,
};

/**
 * Estimate token count from messages.
 * Rough heuristic: ~4 chars per token. For real counting, use a tokenizer,
 * but this is good enough for threshold decisions.
 */
export function estimateTokens(messages: unknown[]): number {
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as any;
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (typeof c === "string") chars += c.length;
        else if (c && typeof c === "object" && typeof c.text === "string") chars += c.text.length;
      }
    }
    chars += 50; // overhead per message
  }
  return Math.ceil(chars / 4);
}

/**
 * Decide whether compaction should fire.
 * Returns the reason if yes, null if no.
 */
export function shouldCompact(
  messages: unknown[],
  contextWindow: number | undefined,
  cfg: AutoCompactConfig = DEFAULT_AUTO_COMPACT,
): string | null {
  if (messages.length > cfg.maxMessages) {
    return `messages.length=${messages.length} > maxMessages=${cfg.maxMessages}`;
  }
  if (contextWindow && contextWindow > 0) {
    const tokens = estimateTokens(messages);
    const fraction = tokens / contextWindow;
    if (fraction > cfg.maxContextFraction) {
      return `tokens=${tokens} / contextWindow=${contextWindow} = ${(fraction * 100).toFixed(1)}% > ${cfg.maxContextFraction * 100}%`;
    }
  }
  return null;
}

/**
 * Run compaction if needed. Returns a summary string if it ran, null otherwise.
 */
export async function maybeCompact(
  tape: Tape,
  sessionId: SessionId,
  messages: unknown[],
  contextWindow: number | undefined,
  cfg: AutoCompactConfig = DEFAULT_AUTO_COMPACT,
): Promise<{ fired: boolean; reason?: string; summarized?: number; kept?: number }> {
  const reason = shouldCompact(messages, contextWindow, cfg);
  if (!reason) return { fired: false };
  const result = await compactSession(tape, sessionId, { keepRecent: cfg.keepRecent });
  return { fired: true, reason, summarized: result.summarized, kept: result.keptRecent };
}
