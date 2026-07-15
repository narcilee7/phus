// src/core/checkpoint.ts
// Checkpoint + resume for crash-resistant long tasks.
//
// Saved automatically:
//   - After every after_tool_call (in PhusAgent)
//   - On SIGTERM (graceful shutdown in gateway)
//   - On uncaughtException (best-effort)
//
// Resume:
//   - `phus resume <sessionId>` — load latest checkpoint, restore messages, continue
//   - `phus run --resume <turnId>` — explicit resume in one-shot mode

import type { Tape } from "@/core/session/tape.js";
import { logger } from "@/infra/logging.js";
import type { SessionId, TurnId } from "@/types/brand.js";
import { asOptionalSessionId, asOptionalTurnId } from "@/types/brand.js";

export interface CheckpointEntry {
  kind: "checkpoint";
  sessionId: SessionId;
  /** Optional: the turn this checkpoint is part of. */
  turnId?: TurnId;
  /** Pi's transcript — full AgentMessage[]. May be large. */
  messages: unknown[];
  ts: number;
}

/** Append a checkpoint to the tape. Uses Date.now() + monotonic counter
 *  for tie-breaking when checkpoints land in the same millisecond. */
let checkpointCounter = 0;

export function saveCheckpoint(
  tape: Tape,
  sessionId: SessionId,
  messages: unknown[],
  turnId?: TurnId,
): void {
  const entry: CheckpointEntry = {
    kind: "checkpoint",
    sessionId,
    turnId,
    messages,
    // ts encodes both wall-clock ms AND a monotonic counter in the lower bits
    // (Date.now() * 1000 + counter) → ensures unique ordering even at sub-ms
    ts: Date.now() * 1000 + (checkpointCounter++ % 1000),
  };
  tape.append(entry);
  logger.debug("checkpoint.saved", {
    sessionId,
    turnId,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    bytes: JSON.stringify(entry).length,
  });
}

/** Load the most recent checkpoint for a session, or undefined. */
export function loadLatestCheckpoint(
  tape: Tape,
  sessionId: SessionId,
): CheckpointEntry | undefined {
  let latest: CheckpointEntry | undefined;
  for (const entry of tape.replay(sessionId)) {
    if (entry.kind === "checkpoint") latest = entry as CheckpointEntry; // last in ts order = latest
  }
  return latest;
}

/** List all checkpoints for a session, newest first. */
export function listCheckpoints(
  tape: Tape,
  sessionId: SessionId,
): CheckpointEntry[] {
  const all: CheckpointEntry[] = [];
  for (const entry of tape.replay(sessionId)) {
    if (entry.kind === "checkpoint") all.push(entry as CheckpointEntry);
  }
  return all.sort((a, b) => b.ts - a.ts);
}

/** Prune old checkpoints, keeping only the last N per session. Delegates to
 *  `Tape#pruneCheckpoints` to avoid opening a second SQLite connection. */
export function pruneCheckpoints(
  tape: Tape,
  sessionId: SessionId,
  keep: number = 5,
): number {
  const deleted = tape.pruneCheckpoints(sessionId, keep);
  logger.debug("checkpoint.pruned", { sessionId, deleted, kept: keep });
  return deleted;
}

// Helpers for callers that receive IDs as raw strings (Commander, CLI,
// plugin config). Centralized here so the rest of the codebase never
// imports `as*` directly.
export const castSessionId = asOptionalSessionId;
export const castTurnId = asOptionalTurnId;