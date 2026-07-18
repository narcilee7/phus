import { describe, expect, it, afterEach } from "vitest";
import { PlanStore } from "@/core/session/plan-store";
import type { Plan } from "@/core/runtime/plan/types";
import { asSessionId } from "@/types/brand";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    sessionId: asSessionId("session-1"),
    goal: "test goal",
    status: "pending",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Plan;
}

describe("PlanStore", () => {
  let store: PlanStore;

  afterEach(() => {
    store?.close();
  });

  it("saves and loads a plan", () => {
    store = new PlanStore(":memory:");
    const plan = makePlan();
    store.save(plan);
    const loaded = store.load(plan.id);
    expect(loaded).toEqual(plan);
  });

  it("updates an existing plan", () => {
    store = new PlanStore(":memory:");
    const plan = makePlan();
    store.save(plan);
    plan.status = "completed";
    plan.updatedAt = 2;
    store.save(plan);
    const loaded = store.load(plan.id);
    expect(loaded?.status).toBe("completed");
    expect(loaded?.updatedAt).toBe(2);
  });

  it("returns undefined for missing plan", () => {
    store = new PlanStore(":memory:");
    expect(store.load("missing")).toBeUndefined();
  });

  it("loads plans by session", () => {
    store = new PlanStore(":memory:");
    const p1 = makePlan({ id: "p1", sessionId: asSessionId("s1") });
    const p2 = makePlan({ id: "p2", sessionId: asSessionId("s1"), status: "running" });
    const p3 = makePlan({ id: "p3", sessionId: asSessionId("s2") });
    store.save(p1);
    store.save(p2);
    store.save(p3);
    const s1 = store.loadBySession("s1");
    expect(s1.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("filters plans by status", () => {
    store = new PlanStore(":memory:");
    const pending = makePlan({ id: "p1", status: "pending" });
    const running = makePlan({ id: "p2", status: "running" });
    store.save(pending);
    store.save(running);
    expect(store.loadBySession("session-1", "running")).toHaveLength(1);
    expect(store.loadBySession("session-1", "running")[0]?.id).toBe("p2");
  });

  it("loads the active plan for a session", () => {
    store = new PlanStore(":memory:");
    const completed = makePlan({ id: "p1", status: "completed", updatedAt: 100 });
    const running = makePlan({ id: "p2", status: "running", updatedAt: 50 });
    store.save(completed);
    store.save(running);
    const active = store.loadActiveForSession("session-1");
    expect(active?.id).toBe("p2");
  });

  it("deletes a plan", () => {
    store = new PlanStore(":memory:");
    const plan = makePlan();
    store.save(plan);
    store.delete(plan.id);
    expect(store.load(plan.id)).toBeUndefined();
  });

  it("loadInterrupted finds only stale running plans (orphans of a dead process)", () => {
    store = new PlanStore(":memory:");
    const stale = makePlan({ id: "stale", status: "running", updatedAt: 100 });
    const fresh = makePlan({ id: "fresh", status: "running", updatedAt: 500 });
    const paused = makePlan({ id: "paused", status: "paused", updatedAt: 100 });
    store.save(stale);
    store.save(fresh);
    store.save(paused);

    const interrupted = store.loadInterrupted(400);
    expect(interrupted.map((p) => p.id)).toEqual(["stale"]);
  });

  it("loadPaused returns paused plans across sessions, newest first", () => {
    store = new PlanStore(":memory:");
    store.save(makePlan({ id: "old", status: "paused", updatedAt: 100, sessionId: asSessionId("s1") }));
    store.save(makePlan({ id: "new", status: "paused", updatedAt: 200, sessionId: asSessionId("s2") }));
    store.save(makePlan({ id: "done", status: "completed", updatedAt: 300, sessionId: asSessionId("s2") }));

    const paused = store.loadPaused();
    expect(paused.map((p) => p.id)).toEqual(["new", "old"]);
  });

  describe("validation_attempts", () => {
    function metrics(over: Partial<{ failures: number; stepCount: number; status: "completed" | "failed" }> = {}) {
      return {
        stepCount: over.stepCount ?? 3,
        failures: over.failures ?? 0,
        durationMs: 10,
        status: over.status ?? "completed",
        recordedAt: Date.now(),
      };
    }

    it("records attempts and returns history newest first", () => {
      store = new PlanStore(":memory:");
      store.recordValidationAttempt("draft-a", "baseline", metrics(), "first", "session-1");
      store.recordValidationAttempt("draft-a", "improved", metrics({ failures: 0, stepCount: 2 }), "second", "session-2");

      const history = store.getValidationHistory("draft-a");
      expect(history).toHaveLength(2);
      expect(history[0]?.outcome).toBe("improved");
      expect(history[1]?.outcome).toBe("baseline");
      expect(history[0]?.sessionId).toBe("session-2");
    });

    it("aggregates stats and tracks last improvement timestamp", () => {
      store = new PlanStore(":memory:");
      store.recordValidationAttempt("draft-b", "baseline", metrics(), "b", "s");
      store.recordValidationAttempt("draft-b", "failed", metrics({ failures: 2 }), "f", "s");
      store.recordValidationAttempt("draft-b", "improved", metrics({ failures: 0 }), "i", "s");
      store.recordValidationAttempt("draft-b", "pending", metrics(), "p", "s");

      const stats = store.getValidationStats("draft-b");
      expect(stats.total).toBe(4);
      expect(stats.improved).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.baseline).toBe(1);
      expect(stats.pending).toBe(1);
      expect(typeof stats.lastImprovedAt).toBe("number");
    });

    it("hasImprovedAtLeastOnce returns true after enough improvements", () => {
      store = new PlanStore(":memory:");
      store.recordValidationAttempt("draft-c", "improved", metrics(), "i", "s");

      expect(store.hasImprovedAtLeastOnce("draft-c", 1)).toBe(true);
      expect(store.hasImprovedAtLeastOnce("draft-c", 2)).toBe(false);
      expect(store.hasImprovedAtLeastOnce("draft-missing")).toBe(false);
    });

    it("ignores malformed rows when reading history", () => {
      store = new PlanStore(":memory:");
      store.recordValidationAttempt("draft-d", "failed", metrics(), "ok", "s");
      // Inject a row with a broken metrics payload to exercise the parse path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).db.prepare(
        "INSERT INTO validation_attempts (draft_name, outcome, metrics, reason, session_id, ts) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("draft-d", "failed", "{not-json", "bad", "s", Date.now());

      const history = store.getValidationHistory("draft-d");
      // Only the well-formed rows survive the filter.
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.every((h) => h.metrics.stepCount >= 0)).toBe(true);
    });
  });
});
