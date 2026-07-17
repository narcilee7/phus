import { describe, expect, it, vi } from "vitest";
import { PlanRunner } from "@/core/runtime/plan-runner.js";
import { Planner } from "@/core/runtime/planner.js";
import { Executor } from "@/core/runtime/executor.js";
import { PlanStore } from "@/core/session/plan-store.js";
import { HookRegistry } from "@/core/runtime/hook.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import { asSessionId } from "@/types/brand.js";

function makePlan(steps: Step[]): Plan {
  return {
    id: "plan-1",
    sessionId: asSessionId("session-1"),
    goal: "goal",
    status: "pending",
    steps,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeStep(index: number, overrides: Partial<Step> = {}): Step {
  return {
    id: `s${index}`,
    index,
    description: `step ${index}`,
    status: "pending",
    retryCount: 0,
    ...overrides,
  };
}

describe("PlanRunner", () => {
  it("runs a plan end-to-end and marks it completed", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {
      createPlan: vi.fn().mockResolvedValue(makePlan([makeStep(0)])),
    } as unknown as Planner;
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        step.status = "completed";
        return { step, verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const } };
      }),
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const plan = await runner.createAndRun("goal", "session-1");

    expect(plan.status).toBe("completed");
    expect(store.load(plan.id)?.status).toBe("completed");
  });

  it("skips steps whose dependencies failed", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const steps = [
      makeStep(0, { id: "a" }),
      makeStep(1, { id: "b", dependsOn: ["a"] }),
    ];
    const planner = {
      createPlan: vi.fn().mockResolvedValue(makePlan(steps)),
    } as unknown as Planner;
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        if (step.id === "a") {
          step.status = "failed";
          return { step, verification: { ok: false, confidence: 0, reason: "", action: "abort" as const } };
        }
        step.status = "completed";
        return { step, verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const } };
      }),
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const plan = await runner.createAndRun("goal", "session-1");

    expect(plan.steps[0]?.status).toBe("failed");
    expect(plan.steps[1]?.status).toBe("skipped");
    expect(plan.status).toBe("failed");
  });

  it("emits step and completion hooks", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const events: string[] = [];
    hooks.register("plan_step_started", async () => { events.push("started"); }, { mode: "broadcast" });
    hooks.register("plan_step_completed", async () => { events.push("completed"); }, { mode: "broadcast" });
    hooks.register("plan_completed", async () => { events.push("plan_completed"); }, { mode: "broadcast" });

    const planner = {
      createPlan: vi.fn().mockResolvedValue(makePlan([makeStep(0)])),
    } as unknown as Planner;
    const executor = {
      executeStep: async (step: Step) => {
        step.status = "completed";
        return { step, verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const } };
      },
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    await runner.createAndRun("goal", "session-1");

    expect(events).toContain("started");
    expect(events).toContain("completed");
    expect(events).toContain("plan_completed");
  });
});
