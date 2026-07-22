import { HookName } from "@phus/core/types/index.js";
import { EvolutionEngine } from "../evolution/engine";
import { Plan, PlanRunnerDeps, Step } from "./types";
import { logger } from "../../../infra/logging.js";
import { loadConfig } from "../../../infra/config/index.js";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";
import { ReplanNeededError } from "../executor/error.js";

export class PlanRunner {
  /** Cooperative cancellation: set by abort() while a run is in flight,
   *  consumed at the next step boundary. The in-flight step is also
   *  aborted via the per-run AbortController so its LLM call resolves
   *  immediately (see `runPlan`). */
  private abortRequested = false;
  private running = false;
  /** Per-run AbortController. Re-armed on every `runPlan` so a stale
   *  signal from a previous (aborted) run doesn't poison the next.
   *  Wired into every sub-agent's per-run signal so a Ctrl+C
   *  reaches the in-flight LLM call. */
  private runAbortController: AbortController = new AbortController();

  constructor(private deps: PlanRunnerDeps) {}

  setEvolutionEngine(engine: EvolutionEngine | undefined): void {
    this.deps.evolutionEngine = engine;
  }

  /** Request the active run to stop after the current step. No-op when
   *  no run is in flight (a stale flag would otherwise kill the NEXT run). */
  abort(): void {
    if (this.running) this.abortRequested = true;
    // Trip the per-run AbortController so every in-flight
    // sub-agent's LLM call resolves immediately. Without this,
    // a Ctrl+C stops *new* step dispatch but the current step
    // keeps streaming for the full model round-trip.
    if (!this.runAbortController.signal.aborted) {
      this.runAbortController.abort();
    }
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
      // Re-arm the per-run AbortController so a previous abort
      // doesn't poison this run. The signal threads into every
      // sub-agent's per-run timeout race; the timeout and the
      // abort() entry point both abort it.
      this.runAbortController = new AbortController();
      const runSignal = this.runAbortController.signal;
      let stoppedEarly = false;
      const runStartedAt = Date.now();
      let executedSteps = 0;

      // Level-based scheduler. Steps are organized into DAG levels:
      //   level 0: no dependencies
      //   level N: at least one dep at level N-1
      // Within a level, every ready step is launched in parallel
      // (concurrency-capped), so an "edit" step and a "test" step
      // that only depend on prior levels run concurrently instead
      // of serially. The level barrier ensures every level N step
      // has its deps resolved before level N+1 starts — the
      // topological invariant that the previous serial loop
      // preserved is now enforced by the level boundary, not by
      // single-step iteration.
      const { levels, levelOf } = this.computeLevels(steps);
      // Annotate every step with its level so the TUI can render
      // a "LvN" badge. The level is a derived property of the
      // DAG; we don't persist it on the Step type, so the
      // assignment here is best-effort and overwritten by the
      // `next`-style step object on every iteration. (Same pattern
      // as the rest of the runner's runtime-side bookkeeping.)
      for (const step of steps) {
        (step as Step & { level?: number }).level = levelOf.get(step.id) ?? 0;
      }
      let parallelExecuted = 0;

      for (const level of levels) {
        if (stoppedEarly) break;

        // Cooperative stops — check before each level so we never
        // start a level of work after the user has aborted.
        const budgetReason = this.budgetHit(runStartedAt, executedSteps, plan.id);
        if (this.abortRequested || budgetReason) {
          stoppedEarly = true;
          const reason = this.abortRequested ? "aborted by user" : budgetReason!;
          for (const s of steps) {
            if (s.status === "pending" || s.status === "running") {
              s.status = "skipped";
              s.error = reason;
            }
          }
          plan.updatedAt = Date.now();
          this.deps.store.save(plan);
          break;
        }

        // Pre-resolve the "ready" set in this level: not blocked,
        // not already-completed, deps satisfied, no failed dep.
        // Failed/dependent-on-failed steps get marked skipped here
        // and never launched.
        const readyInLevel: Step[] = [];
        for (const step of level) {
          if (step.status === "completed") continue;
          if (step.status === "blocked") {
            failed.add(step.id);
            step.error = step.error ?? "blocked: awaiting external resolution";
            this.emitStep("plan_step_failed", plan, step, {
              reason: step.error,
              blocked: true,
            });
            continue;
          }
          if (step.status === "running") step.status = "pending";
          step.error = undefined;

          const deps = step.dependsOn ?? [];
          const depFailed = deps.some((id: string) => failed.has(id));
          const depMissing = deps.some((id: string) => !completed.has(id));
          if (depFailed) {
            step.status = "skipped";
            step.error = "dependency failed";
            failed.add(step.id);
            this.emitStep("plan_step_failed", plan, step, { reason: step.error });
            continue;
          }
          if (depMissing) {
            // Dep was never resolved (cyclic graph, missing
            // dep id) — skip rather than block forever.
            step.status = "skipped";
            step.error = "dependency not ready";
            failed.add(step.id);
            this.emitStep("plan_step_failed", plan, step, { reason: step.error });
            continue;
          }
          readyInLevel.push(step);
        }

        if (readyInLevel.length === 0) continue;

        // Concurrency cap: 3 parallel sub-agents at once. Tuned
        // for the typical case where each sub-agent is one LLM
        // call + a few tool calls; going higher risks hitting
        // provider rate limits.
        const cap = 3;
        for (let i = 0; i < readyInLevel.length; i += cap) {
          if (this.abortRequested) {
            stoppedEarly = true;
            break;
          }
          // Trim the batch against the step-count budget. If
          // planMaxSteps=1 and we've already executed 0 steps, the
          // batch can only contain 1 step — the rest get skipped
          // by the budget hit check below. This preserves the
          // "stop at N steps" semantic that the previous serial
          // loop provided.
          const budgetLeft = this.budgetRemaining(executedSteps, plan.id, runStartedAt);
          if (budgetLeft === "exceeded") {
            stoppedEarly = true;
            const reason = `budget exceeded before step ${i + 1} of level`;
            for (const s of readyInLevel.slice(i)) {
              if (s.status === "pending" || s.status === "running") {
                s.status = "skipped";
                s.error = reason;
              }
            }
            plan.updatedAt = Date.now();
            this.deps.store.save(plan);
            break;
          }
          let batch = readyInLevel.slice(i, i + cap);
          if (typeof budgetLeft === "number" && batch.length > budgetLeft) {
            // Trim the batch to the remaining budget, then mark
            // the rest of the level as skipped with the same
            // budget reason. The level ends here so all remaining
            // "ready" steps in this level never run.
            const cfg = (() => {
              try { return loadConfig().robustness; } catch { return { planMaxSteps: 0 }; }
            })();
            const reason = `budget exceeded: ${cfg.planMaxSteps} steps executed`;
            for (const s of readyInLevel.slice(i + budgetLeft)) {
              if (s.status === "pending" || s.status === "running") {
                s.status = "skipped";
                s.error = reason;
              }
            }
            batch = batch.slice(0, budgetLeft);
            // Mark the plan as stopped early so the terminal
            // state lands on "paused" rather than "failed".
            stoppedEarly = true;
          }

          // Mark every step in the batch as "running" + persist
          // BEFORE awaiting, so a sub-agent abort sees consistent
          // state.
          for (const step of batch) {
            step.status = "running";
            this.emitStep("plan_step_started", plan, step);
          }
          this.deps.store.save(plan);

          // Run the batch in parallel. Each promise resolves with
          // a tagged outcome so we can decide what to do with
          // each step after the join.
          const outcomes = await Promise.allSettled(
            batch.map((step) => this.executeAndClassify(step, plan, failed, completed, runStartedAt, runSignal)),
          );

          // Process each outcome — set step.status, update the
          // shared sets, and surface replan / abort decisions.
          for (let j = 0; j < batch.length; j++) {
            const step = batch[j]!;
            const r = outcomes[j]!;
            if (r.status === "fulfilled") {
              const out = r.value;
              if (out.replanRequested) replanRequested = true;
              if (out.stoppedEarly) stoppedEarly = true;
              executedSteps++;
              parallelExecuted++;
            } else {
              // Should be rare: executeAndClassify catches its own
              // errors. If something bubbles up, mark the step
              // failed and keep going.
              failed.add(step.id);
              step.status = "failed";
              step.error = r.reason instanceof Error ? r.reason.message : String(r.reason);
              this.emitStep("plan_step_failed", plan, step, { error: step.error });
              executedSteps++;
            }
          }

          plan.updatedAt = Date.now();
          this.deps.store.save(plan);

          if (replanRequested || stoppedEarly) break;
        }
      }

      if (parallelExecuted > 0) {
        logger.info("plan.dag_parallel", {
          planId: plan.id,
          parallelSteps: parallelExecuted,
          levelCount: levels.length,
        });
      }
      // (legacy: executedSteps is incremented inside the batch loop)
      void executedSteps;

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

  /** How many more steps we can dispatch before tripping the budget.
   *  Returns:
   *    - "exceeded": no more steps allowed (already at/over limit)
   *    - undefined: no planMaxSteps cap set (caller decides)
   *    - number: remaining step budget for this plan
   *  Wall-clock budget is checked separately via budgetHit. */
  private budgetRemaining(
    executedSteps: number,
    _planId: string,
    _runStartedAt: number,
  ): "exceeded" | number | undefined {
    let cfg;
    try {
      cfg = loadConfig().robustness;
    } catch {
      return undefined;
    }
    if (cfg.planMaxSteps > 0) {
      const remaining = cfg.planMaxSteps - executedSteps;
      if (remaining <= 0) return "exceeded";
      return remaining;
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

  /**
   * Compute topological "levels" for the DAG. Level 0 holds every
   * step with no `dependsOn`; level N holds steps whose deps are
   * all at level < N. Steps within a level can run in parallel.
   * Returns an array of arrays, ordered low→high. Cycles and
   * missing dep ids are tolerated (those steps get pushed to the
   * last level and will be skipped downstream — see the level
   * loop in `runPlan`).
   */
  private computeLevels(steps: Step[]): { levels: Step[][]; levelOf: Map<string, number> } {
    const map = new Map(steps.map((s) => [s.id, s]));
    const levelOf = new Map<string, number>();
    const visiting = new Set<string>();
    const cycles = new Set<string>();

    const compute = (step: Step): number => {
      if (levelOf.has(step.id)) return levelOf.get(step.id)!;
      if (cycles.has(step.id)) return 0;
      if (visiting.has(step.id)) {
        // Cycle — push the cycle node to a late level; the run
        // loop will surface it via depMissing.
        cycles.add(step.id);
        return 0;
      }
      visiting.add(step.id);
      let max = 0;
      for (const depId of step.dependsOn ?? []) {
        const dep = map.get(depId);
        if (!dep) continue; // missing dep — handled in runLevels
        max = Math.max(max, compute(dep) + 1);
      }
      visiting.delete(step.id);
      levelOf.set(step.id, max);
      return max;
    };

    for (const step of steps) compute(step);

    // Group steps by level
    const maxLevel = Math.max(0, ...levelOf.values());
    const levels: Step[][] = Array.from({ length: maxLevel + 1 }, () => []);
    for (const step of steps) {
      const lv = levelOf.get(step.id) ?? 0;
      levels[lv]!.push(step);
    }
    return { levels, levelOf };
  }

  /** Execute one step + classify the outcome. The shared `failed` /
   *  `completed` sets are mutated in place so the level loop can
   *  pick up the changes for downstream scheduling decisions.
   *  `runSignal` is plumbed to the executor so a Ctrl+C aborts the
   *  in-flight sub-agent's LLM call (and any in-progress tool
   *  calls) immediately. */
  private async executeAndClassify(
    step: Step,
    plan: Plan,
    failed: Set<string>,
    completed: Set<string>,
    runStartedAt: number,
    runSignal: AbortSignal,
  ): Promise<{ replanRequested: boolean; stoppedEarly: boolean }> {
    try {
      const { verification } = await this.deps.executor.executeStep(step, plan, runSignal);
      if (verification.action === "proceed") {
        step.status = "completed";
        step.error = undefined;
        completed.add(step.id);
        this.emitStep("plan_step_completed", plan, step, { verification });
        return { replanRequested: false, stoppedEarly: false };
      }
      // verifier said retry / abort / escalate — treat as failure
      // for the current pass. The retry path lives in
      // executeStep's internal loop; by the time we get here,
      // the step has already exhausted its retry budget.
      step.status = "failed";
      step.error = verification.reason;
      failed.add(step.id);
      this.emitStep("plan_step_failed", plan, step, { verification });
      return { replanRequested: false, stoppedEarly: false };
    } catch (err) {
      failed.add(step.id);
      step.status = "failed";
      step.error = err instanceof Error ? err.message : String(err);
      this.emitStep("plan_step_failed", plan, step, { error: step.error });
      if (err instanceof ReplanNeededError) {
        return { replanRequested: true, stoppedEarly: false };
      }
      return { replanRequested: false, stoppedEarly: false };
    }
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
        extras: {
          plan,
          step,
          // Surface the step's DAG level on every event so the TUI
          // can render a "LvN" badge without re-deriving the DAG.
          // Falls back to 0 for steps that pre-date the level
          // annotation (none in the current code, but defensive).
          level: (step as Step & { level?: number }).level ?? 0,
          ...extras,
        },
      }),
      "broadcast",
    );
  }
}
