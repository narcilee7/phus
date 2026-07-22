// src/tui/transform/compact-events.ts
// Map PhusAgent compact lifecycle events to AppState transitions.

import type { AppAction } from "../state/state.js";

export interface CompactEventLike {
  type: string;
  sessionId?: string;
  ratio?: number;
  tokens?: number;
  contextWindow?: number;
  inputBudget?: number;
  summarized?: number;
  kept?: number;
  anchorName?: string;
  reason?: string;
  error?: string;
}

/** Build a compact human-readable line for the chat. The TUI renders
 *  `add_system` items as a single line; long context dumps stay in
 *  the structured log ($PHUS_LOG_FILE). */
function formatCompactLine(event: CompactEventLike): string {
  const pct = (event.ratio ?? 0) * 100;
  const tokensK = (event.tokens ?? 0).toLocaleString();
  switch (event.type) {
    case "context_near_limit":
      return `⚠ context ${pct.toFixed(0)}% full (${tokensK} tokens) — compact will trigger soon`;
    case "context_compacting":
      return `🗜 compacting — ${pct.toFixed(0)}% of context used (${tokensK} tokens)`;
    case "context_compacted": {
      const s = event.summarized ?? 0;
      const k = event.kept ?? 0;
      const anchor = event.anchorName ? ` · ${event.anchorName}` : "";
      return `✓ compacted — ${s} older turn${s === 1 ? "" : "s"} → kept ${k} recent${anchor}`;
    }
    case "compact_failed":
      return `✗ compact failed: ${event.error ?? "unknown error"}`;
    default:
      return `[compact] ${event.type}`;
  }
}

export function compactEventToAction(event: CompactEventLike): AppAction | null {
  if (!event.type) return null;
  const level =
    event.type === "context_near_limit" ? "warn" :
    event.type === "compact_failed" ? "error" :
    "info";
  return {
    type: "add_system",
    text: formatCompactLine(event),
    level,
  };
}
