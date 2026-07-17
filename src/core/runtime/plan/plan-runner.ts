import { HookName } from "@/types";
import { EvolutionEngine } from "../evolution/engine";
import { Plan, PlanRunnerDeps, Step } from "./types";
import { logger } from "@/infra/logging";
import { makeCtx } from "@/core/runtime/hook/ctx-builder";

export class PlanRunner {
  constructor(private deps: PlanRunnerDeps) {}

  setEvolutionEngine(engine: EvolutionEngine | undefined): void {
    this.deps.evolutionEngine = engine;
  }

  async createAndRun(goal: string, sessionId: string, context?: string): Promise<Plan> {
    const plan = await this.deps.planner.createPlan(goal, sessionId, context);
    return this.runPlan(plan);
  }

  async runPlan(plan: Plan): Promise<Plan> {
    plan.status = "running";
    plan.updatedAt = Date.now();
    // Transaction ??
    this.deps.store.save(plan);

    const steps = this.sortSteps(plan.steps);
    const completed = new Set<string>();
    const failed = new Set<string>();

    for (const step of steps) {
      const deps = step.dependsOn ?? [];
      const depFailed = deps.some((id) => failed.has(id));
      const depMissing = deps.some((id) => !completed.has(id));

      if (depFailed || depMissing) {
        step.status = "skipped";
        this.emitStep("plan_step_failed", plan, step, {
          reason: depFailed ? "dependency failed" : "dependency not ready",
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
        if (step.status === "completed") {
          completed.add(step.id);
          this.emitStep("plan_step_completed", plan, step, { verification });
        } else {
          failed.add(step.id);
          this.emitStep("plan_step_failed", plan, step, { verification });
        }
      } catch (err) {
        failed.add(step.id);
        step.status = "failed";
        this.emitStep("plan_step_failed", plan, step, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      plan.updatedAt = Date.now();
      this.deps.store.save(plan);
    }

    const allCompleted = plan.steps.every((s) => s.status === "completed");
    plan.status = allCompleted ? "completed" : "failed";
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
