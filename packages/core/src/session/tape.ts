// src/core/tape.ts
// SQLite-backed append-only event log.
// Schema: one row per entry, indexed by session_id + ts.

import type BetterSqlite3 from "better-sqlite3";
import type { TapeEntry, Turn, TapeAnchorRef } from "../types/tape/index.js";
import { SessionStorage } from "./session-storage.js";

export class Tape {
  private readonly storage: SessionStorage;
  private readonly ownsStorage: boolean;
  private readonly insertStmt: BetterSqlite3.Statement<[
    number,
    string,
    string,
    string,
    string,
  ]>;

  /** `dbPath` is required — callers get the path from `loadConfig().paths.tapeDb`. */
  constructor(input: string | SessionStorage) {
    this.ownsStorage = typeof input === "string";
    this.storage = typeof input === "string" ? new SessionStorage(input) : input;
    this.init();
    this.insertStmt = this.storage.prepare<[
      number,
      string,
      string,
      string,
      string,
    ]>("INSERT INTO tape (ts, session_id, kind, payload, meta) VALUES (?, ?, ?, ?, ?)");
  }

  private init(): void {
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS tape (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        session_id  TEXT    NOT NULL,
        kind        TEXT    NOT NULL,
        payload     TEXT    NOT NULL,
        meta        TEXT    NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_tape_session_ts ON tape(session_id, ts);
      CREATE INDEX IF NOT EXISTS idx_tape_kind ON tape(kind);
    `);
  }

  /** Append one entry to the tape. */
  append(entry: TapeEntry, meta: Record<string, unknown> = {}): void {
    const ts = "ts" in entry ? entry.ts : Date.now();
    const sessionId = this.sessionIdOf(entry);
    const payload = JSON.stringify(entry);
    this.insertStmt.run(ts, sessionId, entry.kind, payload, JSON.stringify(meta));
    // Phase 1 keeps Tape writes behavior-compatible. A later Session-bound
    // event API will update sessions.last_turn_at in the same transaction.
  }

  private sessionIdOf(entry: TapeEntry): string {
    if ("sessionId" in entry && typeof entry.sessionId === "string") return entry.sessionId;
    if (entry.kind === "turn") return entry.turn.sessionId;
    return "_system";
  }

  /** Stream all entries for a session, oldest first. */
  *replay(sessionId?: string): Generator<TapeEntry> {
    const rows = sessionId
      ? this.storage.prepare("SELECT payload FROM tape WHERE session_id = ? ORDER BY ts ASC, id ASC").all(sessionId)
      : this.storage.prepare("SELECT payload FROM tape ORDER BY ts ASC, id ASC").all();

    for (const row of rows as Array<{ payload: string }>) {
      try {
        yield JSON.parse(row.payload) as TapeEntry;
      } catch {
        // skip malformed rows
      }
    }
  }

  /** Recent turn summary as plain text, for system prompt injection. */
  summary(sessionId: string, limit = 10): string {
    const rows = this.storage.prepare(
      `SELECT payload FROM tape WHERE session_id = ? AND kind = 'turn' ORDER BY ts DESC, id DESC LIMIT ?`,
    ).all(sessionId, limit) as Array<{ payload: string }>;

    // Reverse so we show oldest → newest.
    return rows
      .reverse()
      .map((r) => {
        const t = JSON.parse(r.payload).turn as Turn;
        const at = new Date(t.ts).toLocaleTimeString();
        const preview = (t.inbound.content || "").slice(0, 80).replace(/\n/g, " ");
        return `[${at}] ${t.inbound.from}: ${preview} → ${(t.modelOutput || "").slice(0, 80).replace(/\n/g, " ")}`;
      })
      .join("\n");
  }

  /** Aggregate stats: total entries + per-session counts. */
  stats(): { totalEntries: number; sessions: Record<string, number> } {
    const total = (this.storage.prepare("SELECT COUNT(*) AS c FROM tape").get() as { c: number }).c;
    const rows = this.storage.prepare(
      "SELECT session_id, COUNT(*) AS c FROM tape GROUP BY session_id",
    ).all() as Array<{ session_id: string; c: number }>;
    const sessions: Record<string, number> = {};
    for (const r of rows) sessions[r.session_id] = r.c;
    return { totalEntries: total, sessions };
  }

  /** Load the latest anchor state for a session, if any. */
  loadAnchor(sessionId: string): TapeAnchorRef | undefined {
    const row = this.storage.prepare(
      `SELECT payload FROM tape WHERE session_id = ? AND kind = 'anchor' ORDER BY ts DESC, id DESC LIMIT 1`,
    ).get(sessionId) as { payload: string } | undefined;
    if (!row) return undefined;
    const entry = JSON.parse(row.payload);
    if (entry.kind !== "anchor") return undefined;
    return { name: entry.name, state: entry.state, ts: entry.ts };
  }

  /** Close storage created by this Tape. Shared storage is closed by its owner. */
  close(): void {
    if (this.ownsStorage) this.storage.close();
  }

  /**
   * Delete the oldest checkpoint rows for a session, keeping the most
   * recent `keep`. Returns the number of rows deleted.
   *
   * Lives on Tape (not in checkpoint.ts) so we don't open a second
   * database connection — `better-sqlite3` is single-process per file.
   */
  pruneCheckpoints(sessionId: string, keep = 5): number {
    const rows = this.storage.prepare(
      `SELECT ts FROM tape WHERE session_id = ? AND kind = 'checkpoint' ORDER BY ts DESC, id DESC`,
    ).all(sessionId) as Array<{ ts: number }>;
    if (rows.length <= keep) return 0;
    const toDelete = rows.slice(keep).map((r) => r.ts);
    const del = this.storage.prepare(
      "DELETE FROM tape WHERE session_id = ? AND kind = 'checkpoint' AND ts = ?",
    );
    let deleted = 0;
    this.storage.transaction(() => {
      for (const ts of toDelete) {
        const r = del.run(sessionId, ts);
        deleted += r.changes;
      }
    });
    return deleted;
  }
}
