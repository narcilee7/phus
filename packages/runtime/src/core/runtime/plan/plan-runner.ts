import { HookName } from "@phus/core/types/index.js";
import { EvolutionEngine } from "../evolution/engine";
import { Plan, PlanRunnerDeps, Step } from "./types";
import { logger } from "../../../infra/logging.js";
import { loadConfig } from "../../../infra/config/index.js";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";
import { ReplanNeededError } from "../executor/error.js";

export class PlanRunner {
  /** Cooperative cancellation: set by abort() while a run is in flight,
   *  consumed at the next step boundary. In-flight steps can't be killed,
   *  but the plan stops after the current step settles instead of running
   *  the whole graph (which looked like a TUI hang). */
  private abortRequested = false;
  private running = false;

  constructor(private deps: PlanRunnerDeps) {}

  setEvolutionEngine(engine: EvolutionEngine | undefined): void {
    this.deps.evolutionEngine = engine;
  }

  /** Request the active run to stop after the current step. No-op when
   *  no run is in flight (a stale flag would otherwise kill the NEXT run). */
  abort(): void {
    if (this.running) this.abortRequested = true;
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

  /** Cap on replan attempts. The previous code threw a
   *  ReplanNeededError and then just set plan.status="paused" — the
   *  plan was never re-generated, so /resume picked up the same
   *  half-finished plan and looped forever. Now we actually call
   *  the planner (with the completed-step output as context) and
   *  retry up to `MAX_REPLAN_ATTEMPTS`. Beyond that, the plan goes
   *  to "paused" with the failure reason recorded — the operator
   *  can read the failed step and adjust the goal. */
  private static readonly MAX_REPLAN_ATTEMPTS = 2;

  async runPlan(plan: Plan): Promise<Plan> {
    // Outer replan loop: when the inner pass settles and a step
    // came back with `replan`, we re-generate the plan with the
    // previous attempt's completed-step output as context, then
    // re-enter the for body. Capped at MAX_REPLAN_ATTEMPTS so a
    // structural failure doesn't spin forever.
    //
    // Implementation note: the body uses `continue` to re-loop and
    // falls through to terminal state code at the end. The terminal
    // block always sets `plan.status` and returns — there is no
    // fall-through off the end of the for body.
    for (let attempt = 0; attempt <= PlanRunner.MAX_REPLAN_ATTEMPTS; attempt++) {
      plan.status = "running";
      plan.updatedAt = Date.now();
      this.deps.store.save(plan);

      const steps = this.sortSteps(plan.steps);
      const completed = new Set(
        steps.filter((step) => step.status === "completed").map((step) => step.id),
      );
      const failed = new Set<string>();
      let replanRequested = false;
      this.running = true;
      this.abortRequested = false;
      let stoppedEarly = false;
      const runStartedAt = Date.now();
      let executedSteps = 0;

      // Inner pass: walk every step in dependency order.
      for (const step of steps) {
        // Cooperative stops — user abort AND runaway budgets. Both
        // halt between steps, mark everything not yet done as
        // skipped, and leave the plan resumable (status "paused").
        const budgetReason = this.budgetHit(runStartedAt, executedSteps, plan.id);
        if (this.abortRequested || budgetReason) {
          stoppedEarly = true;
          const reason = this.abortRequested ? "aborted by user" : budgetReason!;
          this.abortRequested = false;
          for (const s of steps) {
            if (s.status === "pending" || s.status === "running") {
              s.status = "skipped";
              s.error = reason;
            }
          }
          plan.updatedAt = Date.now();
          this.deps.store.save(plan);
          this.emitStep("plan_step_failed", plan, step, { reason });
          break;
        }

        if (step.status === "completed") {
          step.error = undefined;
          continue;
        }

        if (step.status === "blocked") {
          // A blocked step is awaiting external resolution (human
          // input, external job, etc.). Carry it forward untouched
          // so the resume path can decide what to do with it.
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
        const depFailed = deps.some((id: string) => failed.has(id));
        const depMissing = deps.some((id: string) => !completed.has(id));

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

        executedSteps++;
        plan.updatedAt = Date.now();
        this.deps.store.save(plan);
      }

      // Inner pass settled. Decide: replan, or settle to terminal.
      const allCompleted = plan.steps.every((s) => s.status === "completed");

      if (replanRequested && attempt < PlanRunner.MAX_REPLAN_ATTEMPTS) {
        // Re-generate the plan with the previous attempt's output as
        // context. The new plan replaces step[] in place but keeps
        // the original plan's identity (id / sessionId / createdAt)
        // so /tape can show the lineage.
        const completedSummary = plan.steps
          .filter((s) => s.status === "completed")
          .map((s) => `- [done] ${s.description}${s.output ? `\n  output: ${String(s.output).slice(0, 240)}` : ""}`)
          .join("\n");
        const failedSummary = plan.steps
          .filter((s) => s.status === "failed")
          .map((s) => `- [failed] ${s.description}\n  reason: ${s.error ?? "unknown"}`)
          .join("\n");
        const replanContext = [
          `Replan attempt ${attempt + 1} of ${PlanRunner.MAX_REPLAN_ATTEMPTS}.`,
          "Steps already completed (DO NOT redo):",
          completedSummary || "(none)",
          "",
          "Steps that failed and need a different approach:",
          failedSummary || "(none)",
          "",
          "Original goal:",
          plan.goal,
        ].join("\n");
        logger.info("plan.replan_requested", {
          planId: plan.id,
          attempt,
          completedCount: plan.steps.filter((s) => s.status === "completed").length,
          failedCount: plan.steps.filter((s) => s.status === "failed").length,
        });
        let newPlan: Plan;
        try {
          newPlan = await this.deps.planner.createPlan(plan.goal, plan.sessionId, replanContext);
        } catch (err) {
          logger.warn("plan.replan_planner_failed", {
            planId: plan.id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Planner itself failed — settle to paused so the
          // operator can inspect via /tape and /plan list.
          plan.status = "paused";
          plan.updatedAt = Date.now();
          this.deps.store.save(plan);
          this.running = false;
          return plan;
        }
        newPlan = {
          ...newPlan,
          id: plan.id,
          sessionId: plan.sessionId,
          createdAt: plan.createdAt,
        };
        Object.assign(plan, newPlan);
        this.deps.store.save(plan);
        this.running = false;
        continue; // re-enter the for-loop with the new step list
      }

      // Terminal state. Reached when the inner pass settled and we
      // did NOT replan (either all done, all failed, user aborted,
      // or replan-exhausted).
      plan.status = stoppedEarly
        ? "paused"
        : replanRequested
          ? "paused" // replan-exhausted (attempt === MAX, fell through the if)
          : allCompleted
            ? "completed"
            : "failed";
      if (replanRequested && attempt >= PlanRunner.MAX_REPLAN_ATTEMPTS) {
        plan.error = `replan exhausted after ${PlanRunner.MAX_REPLAN_ATTEMPTS} attempts — last failure: ${
          plan.steps.find((s) => s.status === "failed")?.error ?? "unknown"
        }`;
      }
      plan.updatedAt = Date.now();
      this.deps.store.save(plan);
      this.running = false;

      if (!stoppedEarly) {
        this.deps.hooks.execute(
          "plan_completed",
          makeCtx({
            sessionId: plan.sessionId,
            extras: { plan },
          }),
          "broadcast",
        );
      }

      if (!stoppedEarly && this.deps.evolutionEngine) {
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

    // Unreachable: every iteration of the for-loop above either
    // `continue`s (replan) or `return`s (terminal). This fallback
    // exists so the TS compiler sees a guaranteed return on every
    // code path and stops flagging "lacks ending return".
    return plan;
  }

  /** Budget check between steps. Returns the stop reason when a guard
   *  trips, undefined otherwise. Cheap enough to run per iteration. */
  private budgetHit(runStartedAt: number, executedSteps: number, planId: string): string | undefined {
    let cfg;
    try {
      cfg = loadConfig().robustness;
    } catch {
      return undefined;
    }
    if (cfg.planMaxSteps > 0 && executedSteps >= cfg.planMaxSteps) {
      logger.warn("plan.budget_exceeded", { planId, scope: "steps", limit: cfg.planMaxSteps });
      return `budget exceeded: ${cfg.planMaxSteps} steps executed`;
    }
    if (cfg.planTimeoutMs > 0 && Date.now() - runStartedAt > cfg.planTimeoutMs) {
      logger.warn("plan.budget_exceeded", { planId, scope: "wall-clock", limitMs: cfg.planTimeoutMs });
      return `budget exceeded: ${Math.round(cfg.planTimeoutMs / 60_000)}m wall-clock`;
    }
    return undefined;
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
