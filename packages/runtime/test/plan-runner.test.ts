import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PlanRunner } from "../src/core/runtime/plan/plan-runner.js";
import { Planner } from "../src/core/runtime/plan/planner.js";
import { Executor } from "../src/core/runtime/executor/index.js";
import { ReplanNeededError } from "../src/core/runtime/executor/error.js";
import { PlanStore } from "@phus/core/session/plan-store.js";
import { HookRegistry } from "@phus/core/runtime/hook/registry";
import { resetConfigCache } from "../src/infra/config/index.js";
import type { Plan, Step } from "../src/core/runtime/plan/types.js";
import { asSessionId } from "@phus/core/types/brand.js";

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

  it("replans when a step throws ReplanNeededError", async () => {
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    // The replan should produce a fresh plan with a different step
    // list — the new step list is what gets executed next. The mock
    // here returns a single new step that proceeds cleanly.
    const planner = {
      createPlan: vi.fn(async (_goal, _sessionId, context) => {
        // Verify the planner received the prior-attempt context
        // (otherwise replan is a no-op).
        expect(context).toContain("Replan attempt 1 of 2");
        return {
          id: "plan-1",
          sessionId: asSessionId("session-1"),
          goal: "goal",
          status: "pending" as const,
          steps: [
            {
              id: "b-prime",
              index: 0,
              description: "do b differently",
              phase: "edit" as const,
              status: "pending" as const,
              retryCount: 0,
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }),
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

    // Replan replaced the old step list with a new one (just
    // "b-prime"). The replan path ran the executor twice — once on
    // the original "b" (which threw ReplanNeededError), once on
    // "b-prime" (which succeeded).
    expect(calls).toEqual(["b", "b-prime"]);
    expect(updated.steps.find((step) => step.id === "b-prime")?.status).toBe("completed");
    expect(updated.status).toBe("completed");
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
    // Linear chain (a → b → c) so the DAG scheduler runs them
    // one per level — the test asserts only "a" runs (the others
    // are skipped when the abort lands mid-step). An independent
    // 3-step plan would put all three in level 0 and the new
    // parallel runner would dispatch them all before the abort
    // takes effect, defeating the test's intent.
    const steps = [
      makeStep(0, { id: "a" }),
      makeStep(1, { id: "b", dependsOn: ["a"] }),
      makeStep(2, { id: "c", dependsOn: ["b"] }),
    ];
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

describe("PlanRunner runaway budgets", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.PHUS_HOME;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-plan-budget-"));
    process.env.PHUS_HOME = dir;
    resetConfigCache();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PHUS_HOME;
    else process.env.PHUS_HOME = prevHome;
    resetConfigCache();
  });

  const writeRobustness = (yamlBody: string) => {
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), yamlBody);
    resetConfigCache();
  };

  const completingExecutor = (delayMs = 0) => ({
    executeStep: vi.fn().mockImplementation(async (step: Step) => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      step.status = "completed";
      return {
        step,
        verification: { ok: true, confidence: 1, reason: "", action: "proceed" as const },
      };
    }),
  }) as unknown as Executor;

  const threeStepPlanner = () =>
    ({
      createPlan: vi.fn().mockResolvedValue(
        makePlan([makeStep(0, { id: "a" }), makeStep(1, { id: "b" }), makeStep(2, { id: "c" })]),
      ),
    }) as unknown as Planner;

  // Linear chain planner — every step depends on the previous.
  // Used by the wall-clock budget test: under the new parallel
  // DAG, three independent steps all run in one level and finish
  // too quickly for the budget to trigger. Chaining forces one
  // step per level, which is what the test was originally written
  // to exercise.
  const chainedPlanner = () =>
    ({
      createPlan: vi.fn().mockResolvedValue(
        makePlan([
          makeStep(0, { id: "a" }),
          makeStep(1, { id: "b", dependsOn: ["a"] }),
          makeStep(2, { id: "c", dependsOn: ["b"] }),
        ]),
      ),
    }) as unknown as Planner;

  it("stops at planMaxSteps, marks the rest skipped, and pauses", async () => {
    writeRobustness("robustness:\n  planMaxSteps: 1\n");
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const executor = completingExecutor();

    const runner = new PlanRunner({ planner: threeStepPlanner(), executor, store, hooks });
    const plan = await runner.createAndRun("goal", "session-1");

    expect(plan.status).toBe("paused");
    expect(plan.steps.find((s) => s.id === "a")?.status).toBe("completed");
    expect(plan.steps.find((s) => s.id === "b")?.status).toBe("skipped");
    expect(plan.steps.find((s) => s.id === "b")?.error).toContain("budget exceeded");
    expect(plan.steps.find((s) => s.id === "c")?.status).toBe("skipped");
  });

  it("stops when the wall-clock budget is blown", async () => {
    writeRobustness("robustness:\n  planTimeoutMs: 1\n  planMaxSteps: 0\n");
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const executor = completingExecutor(5); // each step burns >1ms

    // Linear chain (a → b → c) so each level runs exactly one
    // step; otherwise the new parallel DAG finishes the whole
    // level in ~5ms and the wall-clock budget never trips.
    const runner = new PlanRunner({ planner: chainedPlanner(), executor, store, hooks });
    const plan = await runner.createAndRun("goal", "session-1");

    expect(plan.status).toBe("paused");
    expect(plan.steps.some((s) => s.status === "skipped")).toBe(true);
    expect(plan.steps.find((s) => s.status === "skipped")?.error).toContain("wall-clock");
  });

  it("0 disables the step budget", async () => {
    writeRobustness("robustness:\n  planMaxSteps: 0\n  planTimeoutMs: 0\n");
    const store = new PlanStore(":memory:");
    const hooks = new HookRegistry({ isolateErrors: true });
    const executor = completingExecutor();

    const runner = new PlanRunner({ planner: threeStepPlanner(), executor, store, hooks });
    const plan = await runner.createAndRun("goal", "session-1");

    expect(plan.status).toBe("completed");
  });
});
