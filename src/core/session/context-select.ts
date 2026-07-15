// src/core/context-select.ts
// Smart context selection — replace blind "last N turns" with relevance scoring.
//
// MVP: keyword overlap (case-insensitive token intersection).
// Phase D: swap in embeddings for semantic similarity.
//
// Falls back to last-N when query is empty or no turns match.

import type { Tape } from "@/core/session/tape.js";
import type { TapeEntry, Turn } from "@/types/tape/index.js";

export interface SelectOptions {
  /** Max turns to include in result. Default 10. */
  budget: number;
  /** Min relevance score to include (0-1). Default 0.05. */
  minScore: number;
  /** Weight given to recent turns (recency boost). Default 0.3. */
  recencyWeight: number;
}

export const DEFAULT_SELECT: SelectOptions = {
  budget: 10,
  minScore: 0.05,
  recencyWeight: 0.3,
};

export interface ScoredTurn {
  turn: Turn;
  score: number;
  recencyBoost: number;
  indexFromEnd: number;
}

/** Tokenize for keyword scoring. */
function tokenize(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/** Score a single turn against a query (Jaccard similarity + recency boost). */
function scoreTurn(turn: Turn, queryTokens: Set<string>, indexFromEnd: number, totalTurns: number, opts: SelectOptions): ScoredTurn {
  const turnTokens = tokenize(
    (turn.inbound.content ?? "") + " " + (turn.modelOutput ?? ""),
  );
  let intersection = 0;
  for (const t of queryTokens) {
    if (turnTokens.has(t)) intersection++;
  }
  const union = queryTokens.size + turnTokens.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  // Recency: 1.0 for most recent, 0.0 for oldest
  const recency = totalTurns > 1 ? 1 - indexFromEnd / totalTurns : 1;
  const recencyBoost = recency * opts.recencyWeight;
  return { turn, score: jaccard, recencyBoost, indexFromEnd };
}

/**
 * Pick the most relevant turns from the tape for a given query.
 * Returns up to `budget` turns, sorted by combined score (relevance + recency).
 * Falls back to last-N when query is empty.
 */
export function selectRelevantTurns(
  tape: Tape,
  sessionId: string,
  query: string,
  opts: SelectOptions = DEFAULT_SELECT,
): Turn[] {
  // Collect all turns, oldest first
  const allTurns: Turn[] = [];
  for (const entry of tape.replay(sessionId)) {
    if (entry.kind === "turn") allTurns.push(entry.turn);
  }

  if (allTurns.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    // Empty query — just take last N
    return allTurns.slice(-opts.budget);
  }

  // Score each turn (indexFromEnd: 0 = most recent)
  const total = allTurns.length;
  const scored: ScoredTurn[] = [];
  for (let i = 0; i < total; i++) {
    const turn = allTurns[i]!;
    const s = scoreTurn(turn, queryTokens, total - 1 - i, total, opts);
    if (s.score + s.recencyBoost >= opts.minScore) {
      scored.push(s);
    }
  }

  // Sort by combined score, then by recency (newer first on tie)
  scored.sort((a, b) => {
    const ca = a.score + a.recencyBoost;
    const cb = b.score + b.recencyBoost;
    if (cb !== ca) return cb - ca;
    return a.indexFromEnd - b.indexFromEnd;
  });

  return scored.slice(0, opts.budget).map((s) => s.turn);
}
