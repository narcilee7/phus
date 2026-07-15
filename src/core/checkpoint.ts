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

import type { Tape } from "./tape.js";
import { logger } from "./logger.js";

export interface CheckpointEntry {
  kind: "checkpoint";
  sessionId: string;
  /** Optional: the turn this checkpoint is part of. */
  turnId?: string;
  /** Pi's transcript — full AgentMessage[]. May be large. */
  messages: unknown[];
  ts: number;
}

/** Append a checkpoint to the tape. Uses Date.now() + monotonic counter
 *  for tie-breaking when checkpoints land in the same millisecond. */
let checkpointCounter = 0;

export function saveCheckpoint(
  tape: Tape,
  sessionId: string,
  messages: unknown[],
  turnId?: string,
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
export function loadLatestCheckpoint(tape: Tape, sessionId: string): CheckpointEntry | undefined {
  let latest: CheckpointEntry | undefined;
  for (const entry of tape.replay(sessionId)) {
    if (entry.kind === "checkpoint") latest = entry; // last in ts order = latest
  }
  return latest;
}

/** List all checkpoints for a session, newest first. */
export function listCheckpoints(tape: Tape, sessionId: string): CheckpointEntry[] {
  const all: CheckpointEntry[] = [];
  for (const entry of tape.replay(sessionId)) {
    if (entry.kind === "checkpoint") all.push(entry);
  }
  return all.sort((a, b) => b.ts - a.ts);
}

/** Prune old checkpoints, keeping only the last N per session. */
export function pruneCheckpoints(tape: Tape, sessionId: string, keep: number = 5): number {
  const all = listCheckpoints(tape, sessionId);
  if (all.length <= keep) return 0;
  const toDelete = all.slice(keep);
  // Use raw DB to delete (Tape doesn't expose a delete method)
  const Database = require("better-sqlite3");
  const dbPath = process.env.PHUS_TAPE_DB ?? "./tape.sqlite";
  const db = new Database(dbPath);
  let deleted = 0;
  const del = db.prepare("DELETE FROM tape WHERE session_id = ? AND ts = ? AND kind = 'checkpoint'");
  for (const cp of toDelete) {
    const r = del.run(sessionId, cp.ts);
    deleted += r.changes;
  }
  db.close();
  logger.debug("checkpoint.pruned", { sessionId, deleted, kept: keep });
  return deleted;
}
