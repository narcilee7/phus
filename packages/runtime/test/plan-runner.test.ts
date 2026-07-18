import { describe, expect, it, vi } from "vitest";
import { PlanRunner } from "@/core/runtime/plan/plan-runner";
import { Planner } from "@/core/runtime/plan/planner";
import { Executor } from "@/core/runtime/executor/index";
import { ReplanNeededError } from "@/core/runtime/executor/error";
import { PlanStore } from "@/core/session/plan-store";
import { HookRegistry } from "@/core/runtime/hook/registry";
import type { Plan, Step } from "@/core/runtime/plan/types";
import { asSessionId } from "@/types/brand";

function makePlan(steps: Step[], status: Plan["status"] = "pending"): Plan {
  return {
    id: "plan-1",
    sessionId: asSessionId("session-1"),
    goal: "goal",
    status,
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

  it("resumes a partially completed plan without rerunning completed steps", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {
      createPlan: vi.fn(),
    } as unknown as Planner;
    const calls: string[] = [];
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        calls.push(step.id);
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "ok", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const plan = makePlan(
      [
        makeStep(0, { id: "a", status: "completed" }),
        makeStep(1, { id: "b", status: "failed" }),
        makeStep(2, { id: "c", status: "skipped", dependsOn: ["b"] }),
      ],
      "paused",
    );

    const updated = await runner.runPlan(plan);

    expect(calls).toEqual(["b", "c"]);
    expect(updated.steps.find((step) => step.id === "a")?.status).toBe("completed");
    expect(updated.steps.find((step) => step.id === "b")?.status).toBe("completed");
    expect(updated.steps.find((step) => step.id === "c")?.status).toBe("completed");
    expect(updated.status).toBe("completed");
  });

  it("pauses a plan when replanning is required", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {
      createPlan: vi.fn(),
    } as unknown as Planner;
    const calls: string[] = [];
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        calls.push(step.id);
        if (step.id === "b") {
          throw new ReplanNeededError("need a new plan");
        }
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "ok", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const plan = makePlan(
      [
        makeStep(0, { id: "a", status: "completed" }),
        makeStep(1, { id: "b", status: "pending" }),
        makeStep(2, { id: "c", status: "pending", dependsOn: ["b"] }),
      ],
      "running",
    );

    const updated = await runner.runPlan(plan);

    expect(calls).toEqual(["b"]);
    expect(updated.steps.find((step) => step.id === "b")?.status).toBe("failed");
    expect(updated.steps.find((step) => step.id === "b")?.error).toContain("need a new plan");
    expect(updated.steps.find((step) => step.id === "c")?.status).toBe("pending");
    expect(updated.status).toBe("paused");
  });

  it("resumePlan loads from store and skips already completed steps", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {} as unknown as Planner;
    const calls: string[] = [];
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        calls.push(step.id);
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "ok", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    // Seed a paused plan into the store.
    const plan = makePlan(
      [
        makeStep(0, { id: "a", status: "completed" }),
        makeStep(1, { id: "b", status: "pending", repairContext: "previous failure: tests broke" }),
      ],
      "paused",
    );
    store.save(plan);

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const updated = await runner.resumePlan(plan.id);

    expect(calls).toEqual(["b"]);
    expect(updated.status).toBe("completed");
    expect(updated.steps.find((step) => step.id === "b")?.status).toBe("completed");
  });

  it("resumePlan throws when plan is already completed", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const plan = makePlan([makeStep(0, { status: "completed" })], "completed");
    store.save(plan);

    const runner = new PlanRunner({
      planner: {} as unknown as Planner,
      executor: {} as unknown as Executor,
      store,
      hooks,
    });

    await expect(runner.resumePlan(plan.id)).rejects.toThrow(/already completed/);
  });

  it("resumeActive returns undefined when no active plan exists", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });

    const runner = new PlanRunner({
      planner: {} as unknown as Planner,
      executor: {} as unknown as Executor,
      store,
      hooks,
    });

    await expect(runner.resumeActive(asSessionId("session-1"))).resolves.toBeUndefined();
  });

  it("blocked steps stay blocked and are skipped on resume", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {} as unknown as Planner;
    const calls: string[] = [];
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        calls.push(step.id);
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "ok", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    const plan = makePlan(
      [
        makeStep(0, { id: "a", status: "blocked", error: "awaiting external approval" }),
        makeStep(1, { id: "b", status: "pending", dependsOn: ["a"] }),
      ],
      "paused",
    );
    store.save(plan);

    const runner = new PlanRunner({ planner, executor, store, hooks });
    const updated = await runner.resumePlan(plan.id);

    // a is blocked -> never executed; b depends on a (failed set), so b is skipped.
    expect(calls).toEqual([]);
    expect(updated.steps.find((step) => step.id === "a")?.status).toBe("blocked");
    expect(updated.steps.find((step) => step.id === "b")?.status).toBe("skipped");
    expect(updated.status).toBe("failed");
  });

  it("abort() stops the run after the current step and leaves it resumable", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const steps = [makeStep(0, { id: "a" }), makeStep(1, { id: "b" }), makeStep(2, { id: "c" })];
    const planner = {
      createPlan: vi.fn().mockResolvedValue(makePlan(steps)),
    } as unknown as Planner;
    const calls: string[] = [];
    let runnerRef: PlanRunner | undefined;
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        calls.push(step.id);
        // Simulate the user hitting Ctrl+C while step "a" is in flight.
        if (step.id === "a") runnerRef?.abort();
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    runnerRef = new PlanRunner({ planner, executor, store, hooks });
    const plan = await runnerRef.createAndRun("goal", "session-1");

    // "a" finished (in-flight steps can't be killed), b/c never started.
    expect(calls).toEqual(["a"]);
    expect(plan.steps.find((s) => s.id === "a")?.status).toBe("completed");
    expect(plan.steps.find((s) => s.id === "b")?.status).toBe("skipped");
    expect(plan.steps.find((s) => s.id === "c")?.status).toBe("skipped");
    // Paused, not failed: /plan resume can pick it up later.
    expect(plan.status).toBe("paused");
    expect(store.load(plan.id)?.status).toBe("paused");
  });

  it("abort() with no run in flight is a no-op (no stale flag kills the next run)", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const planner = {
      createPlan: vi.fn().mockResolvedValue(makePlan([makeStep(0)])),
    } as unknown as Planner;
    const executor = {
      executeStep: vi.fn().mockImplementation(async (step: Step) => {
        step.status = "completed";
        return {
          step,
          verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const },
        };
      }),
    } as unknown as Executor;

    const runner = new PlanRunner({ planner, executor, store, hooks });
    runner.abort(); // nothing running — must not poison the next run
    const plan = await runner.createAndRun("goal", "session-1");
    expect(plan.status).toBe("completed");
  });
});
