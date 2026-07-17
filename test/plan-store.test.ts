import { describe, expect, it, afterEach } from "vitest";
import { PlanStore } from "@/core/session/plan-store.js";
import type { Plan } from "@/core/runtime/plan/types.js";
import { asSessionId } from "@/types/brand.js";

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
});
