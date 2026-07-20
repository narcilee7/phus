import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plan, PlanStatus } from "@phus/runtime/core/runtime/plan/types.js";

export interface ValidationMetrics {
  stepCount: number;
  failures: number;
  durationMs: number;
  status: "completed" | "failed";
  recordedAt: number;
}

export type ValidationOutcome = "improved" | "baseline" | "pending" | "failed";

export interface ValidationAttempt {
  draftName: string;
  outcome: ValidationOutcome;
  metrics: ValidationMetrics;
  reason: string;
  sessionId: string | undefined;
  ts: number;
}

export class PlanStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    }
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

      CREATE TABLE IF NOT EXISTS validation_baselines (
        draft_name TEXT PRIMARY KEY,
        metrics TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS validation_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_name TEXT NOT NULL,
        outcome TEXT NOT NULL,
        metrics TEXT NOT NULL,
        reason TEXT NOT NULL,
        session_id TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_validation_attempts_draft
        ON validation_attempts(draft_name, ts DESC);
    `);
  }

  save(plan: Plan): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO plans (id, session_id, status, payload, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(plan.id, plan.sessionId, plan.status, JSON.stringify(plan), plan.updatedAt);
  }

  load(planId: string): Plan | undefined {
    const row = this.db
      .prepare("SELECT payload FROM plans WHERE id = ?")
      .get(planId) as { payload: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload) as Plan;
    } catch {
      return undefined;
    }
  }

  loadBySession(sessionId: string, status?: PlanStatus): Plan[] {
    const rows = status
      ? (this.db
        .prepare("SELECT payload FROM plans WHERE session_id = ? AND status = ? ORDER BY updated_at DESC")
        .all(sessionId, status) as Array<{ payload: string }>)
      : (this.db
        .prepare("SELECT payload FROM plans WHERE session_id = ? ORDER BY updated_at DESC")
        .all(sessionId) as Array<{ payload: string }>);
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payload) as Plan;
        } catch {
          return undefined;
        }
      })
      .filter((p): p is Plan => p !== undefined);
  }

  loadActiveForSession(sessionId: string): Plan | undefined {
    const rows = this.db
      .prepare("SELECT payload FROM plans WHERE session_id = ? ORDER BY updated_at DESC")
      .all(sessionId) as Array<{ payload: string }>;
    for (const row of rows) {
      try {
        const plan = JSON.parse(row.payload) as Plan;
        if (plan.status !== "completed" && plan.status !== "failed") {
          return plan;
        }
      } catch {
        // skip malformed rows
      }
    }
    return undefined;
  }

  /**
   * Plans left "running" by a dead process: status is `running` but the
   * row hasn't been updated since `cutoffMs` (typically the current
   * process's start time). Plans are durable citizens — this is how we
   * find the ones whose writer died mid-flight.
   */
  loadInterrupted(cutoffMs: number): Plan[] {
    const rows = this.db
      .prepare(
        "SELECT payload FROM plans WHERE status = 'running' AND updated_at < ? ORDER BY updated_at DESC",
      )
      .all(cutoffMs) as Array<{ payload: string }>;
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payload) as Plan;
        } catch {
          return undefined;
        }
      })
      .filter((p): p is Plan => p !== undefined);
  }

  /** Paused plans across every session, newest first — the resumable
   *  backlog surfaced by the TUI's startup prompt. */
  loadPaused(): Plan[] {
    const rows = this.db
      .prepare("SELECT payload FROM plans WHERE status = 'paused' ORDER BY updated_at DESC")
      .all() as Array<{ payload: string }>;
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.payload) as Plan;
        } catch {
          return undefined;
        }
      })
      .filter((p): p is Plan => p !== undefined);
  }

  delete(planId: string): void {
    this.db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
  }

  // ─── Skill validation baselines ────────────────────────────────

  recordValidationBaseline(draftName: string, metrics: ValidationMetrics): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO validation_baselines (draft_name, metrics, updated_at) VALUES (?, ?, ?)",
    );
    stmt.run(draftName, JSON.stringify(metrics), Date.now());
  }

  getValidationBaseline(draftName: string): ValidationMetrics | undefined {
    const row = this.db
      .prepare("SELECT metrics FROM validation_baselines WHERE draft_name = ?")
      .get(draftName) as { metrics: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.metrics) as ValidationMetrics;
    } catch {
      return undefined;
    }
  }

  // ─── Validation attempt history ───────────────────────────────────

  recordValidationAttempt(
    draftName: string,
    outcome: ValidationAttempt["outcome"],
    metrics: ValidationMetrics,
    reason: string,
    sessionId?: string,
  ): ValidationAttempt {
    const ts = Date.now();
    const stmt = this.db.prepare(
      "INSERT INTO validation_attempts (draft_name, outcome, metrics, reason, session_id, ts) VALUES (?, ?, ?, ?, ?, ?)",
    );
    stmt.run(draftName, outcome, JSON.stringify(metrics), reason, sessionId ?? null, ts);
    return { draftName, outcome, metrics, reason, sessionId, ts };
  }

  getValidationHistory(draftName: string, limit = 20): ValidationAttempt[] {
    const rows = this.db
      .prepare(
        "SELECT draft_name, outcome, metrics, reason, session_id, ts FROM validation_attempts WHERE draft_name = ? ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .all(draftName, limit) as Array<{
      draft_name: string;
      outcome: string;
      metrics: string;
      reason: string;
      session_id: string | null;
      ts: number;
    }>;
    return rows
      .map((r) => {
        try {
          return {
            draftName: r.draft_name,
            outcome: this.normalizeOutcome(r.outcome),
            metrics: JSON.parse(r.metrics) as ValidationMetrics,
            reason: r.reason,
            sessionId: r.session_id ?? undefined,
            ts: r.ts,
          };
        } catch {
          return undefined;
        }
      })
      .filter((a): a is ValidationAttempt => a !== undefined);
  }

  getValidationStats(draftName: string): {
    total: number;
    improved: number;
    failed: number;
    pending: number;
    baseline: number;
    lastImprovedAt?: number;
  } {
    const rows = this.db
      .prepare(
        "SELECT outcome, ts FROM validation_attempts WHERE draft_name = ? ORDER BY ts DESC, id DESC",
      )
      .all(draftName) as Array<{ outcome: string; ts: number }>;
    const stats = { total: rows.length, improved: 0, failed: 0, pending: 0, baseline: 0 } as {
      total: number;
      improved: number;
      failed: number;
      pending: number;
      baseline: number;
      lastImprovedAt?: number;
    };
    for (const r of rows) {
      const o = this.normalizeOutcome(r.outcome);
      if (o === "improved") {
        stats.improved++;
        stats.lastImprovedAt = r.ts;
      } else if (o === "failed") stats.failed++;
      else if (o === "pending") stats.pending++;
      else if (o === "baseline") stats.baseline++;
    }
    return stats;
  }

  hasImprovedAtLeastOnce(draftName: string, minTimes = 1): boolean {
    const stats = this.getValidationStats(draftName);
    return stats.improved >= minTimes;
  }

  private normalizeOutcome(raw: unknown): ValidationAttempt["outcome"] {
    if (raw === "improved" || raw === "baseline" || raw === "pending" || raw === "failed") {
      return raw;
    }
    return "failed";
  }

  close(): void {
    this.db.close();
  }
}
