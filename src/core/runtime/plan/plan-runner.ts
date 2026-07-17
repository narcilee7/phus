import { HookName } from "@/types";
import { EvolutionEngine } from "../evolution/engine";
import { Plan, PlanRunnerDeps, Step } from "./types";
import { logger } from "@/infra/logging";
import { makeCtx } from "@/core/runtime/hook/ctx-builder";
import { ReplanNeededError } from "@/core/runtime/executor/error";

export class PlanRunner {
  constructor(private deps: PlanRunnerDeps) {}

  setEvolutionEngine(engine: EvolutionEngine | undefined): void {
    this.deps.evolutionEngine = engine;
  }

  async createAndRun(goal: string, sessionId: string, context?: string): Promise<Plan> {
    const plan = await this.deps.planner.createPlan(goal, sessionId, context);
    return this.runPlan(plan);
  }

  /**
   * Resume a previously persisted plan by id. Loads from store, then runs
   * the same recovery loop as `runPlan` — completed steps are skipped,
   * running steps reset to pending, failed/blocked steps keep their reason.
   * Throws if the plan is not found or is already in a terminal state.
   */
  async resumePlan(planId: string): Promise<Plan> {
    const plan = this.deps.store.load(planId);
    if (!plan) {
      throw new Error(`plan ${planId} not found`);
    }
    if (plan.status === "completed") {
      throw new Error(`plan ${planId} is already completed`);
    }
    return this.runPlan(plan);
  }

  /**
   * Resume the most recent active (paused/failed/pending) plan for a session.
   * Returns undefined when no active plan exists.
   */
  async resumeActive(sessionId: string): Promise<Plan | undefined> {
    const plan = this.deps.store.loadActiveForSession(sessionId);
    if (!plan) return undefined;
    return this.resumePlan(plan.id);
  }

  async runPlan(plan: Plan): Promise<Plan> {
    plan.status = "running";
    plan.updatedAt = Date.now();
    // Transaction ??
    this.deps.store.save(plan);

    const steps = this.sortSteps(plan.steps);
    const completed = new Set(
      steps.filter((step) => step.status === "completed").map((step) => step.id),
    );
    const failed = new Set<string>();
    let replanRequested = false;

    for (const step of steps) {
      if (step.status === "completed") {
        step.error = undefined;
        continue;
      }

      if (step.status === "blocked") {
        // A blocked step is awaiting external resolution (human input,
        // external job, etc.). Carry it forward untouched so the resume
        // path can decide what to do with it.
        failed.add(step.id);
        step.error = step.error ?? "blocked: awaiting external resolution";
        this.emitStep("plan_step_failed", plan, step, {
          reason: step.error,
          blocked: true,
        });
        plan.updatedAt = Date.now();
        this.deps.store.save(plan);
        continue;
      }

      if (step.status === "running") {
        step.status = "pending";
      }

      step.error = undefined;

      const deps = step.dependsOn ?? [];
      const depFailed = deps.some((id) => failed.has(id));
      const depMissing = deps.some((id) => !completed.has(id));

      if (depFailed || depMissing) {
        step.status = "skipped";
        step.error = depFailed ? "dependency failed" : "dependency not ready";
        this.emitStep("plan_step_failed", plan, step, {
          reason: step.error,
        });
        failed.add(step.id);
        plan.updatedAt = Date.now();
        this.deps.store.save(plan);
        continue;
      }

      this.emitStep("plan_step_started", plan, step);
      this.deps.store.save(plan);

      try {
        const { verification } = await this.deps.executor.executeStep(step, plan);
        if (verification.action === "proceed") {
          step.status = "completed";
          step.error = undefined;
          completed.add(step.id);
          this.emitStep("plan_step_completed", plan, step, { verification });
        } else {
          step.status = "failed";
          step.error = verification.reason;
          failed.add(step.id);
          this.emitStep("plan_step_failed", plan, step, { verification });
        }
      } catch (err) {
        failed.add(step.id);
        step.status = "failed";
        step.error = err instanceof Error ? err.message : String(err);
        this.emitStep("plan_step_failed", plan, step, {
          error: step.error,
        });
        if (err instanceof ReplanNeededError) {
          replanRequested = true;
          plan.updatedAt = Date.now();
          this.deps.store.save(plan);
          break;
        }
      }

      plan.updatedAt = Date.now();
      this.deps.store.save(plan);
    }

    const allCompleted = plan.steps.every((s) => s.status === "completed");
    plan.status = replanRequested ? "paused" : allCompleted ? "completed" : "failed";
    plan.updatedAt = Date.now();
    this.deps.store.save(plan);

    this.deps.hooks.execute(
      "plan_completed",
      makeCtx({
        sessionId: plan.sessionId,
        extras: { plan },
      }),
      "broadcast",
    );

    if (this.deps.evolutionEngine) {
      try {
        await this.deps.evolutionEngine.onPlanCompleted(plan);
      } catch (err) {
        logger.warn("plan_runner.evolution_failed", {
          planId: plan.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return plan;
  }

  private sortSteps(steps: Step[]): Step[] {
    const map = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const result: Step[] = [];

    const visit = (step: Step, stack: Set<string> = new Set()) => {
      if (visited.has(step.id)) return;
      if (stack.has(step.id)) {
        logger.warn("plan_runner.cyclic_dependency", { stepId: step.id });
        return;
      }
      stack.add(step.id);
      for (const depId of step.dependsOn ?? []) {
        const dep = map.get(depId);
        if (dep) visit(dep, stack);
      }
      visited.add(step.id);
      result.push(step);
    };

    for (const step of steps) visit(step);
    return result;
  }

  private emitStep(
    name: HookName,
    plan: Plan,
    step: Step,
    extras: Record<string, unknown> = {},
  ): void {
    this.deps.hooks.execute(
      name,
      makeCtx({
        sessionId: plan.sessionId,
        extras: { plan, step, ...extras },
      }),
      "broadcast",
    );
  }
}
