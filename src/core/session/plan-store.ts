import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Plan, PlanStatus } from "@/core/runtime/plan/types.js";

export interface ValidationMetrics {
  stepCount: number;
  failures: number;
  durationMs: number;
  status: "completed" | "failed";
  recordedAt: number;
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

  close(): void {
    this.db.close();
  }
}
