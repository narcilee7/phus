import { Type } from "@mariozechner/pi-ai";
import type { MetaTool } from "@/types/tool.js";
import type { SessionId } from "@/types/brand.js";
import type { PlanRunner } from "@/core/runtime/plan-runner.js";
import type { PlanStore } from "@/core/session/plan-store.js";

export function definePlanMetaTools(deps: {
  planRunner: PlanRunner;
  planStore: PlanStore;
  getCurrentSessionId: () => SessionId | undefined;
}): MetaTool[] {
  return [
    {
      name: "plan_create",
      description:
        "Create a multi-step plan from a goal and execute it. Returns the plan id and final status.",
      parameters: Type.Object({
        goal: Type.String({ description: "High-level goal to plan and execute." }),
        context: Type.Optional(Type.String({ description: "Additional context for the planner." })),
      }),
      execute: async (args) => {
        const sessionId = deps.getCurrentSessionId();
        if (!sessionId) return { ok: false, error: "no current session" };
        const goal = String(args.goal);
        const context = args.context ? String(args.context) : undefined;
        const plan = await deps.planRunner.createAndRun(goal, sessionId, context);
        return { ok: true, planId: plan.id, status: plan.status };
      },
    },
    {
      name: "plan_run",
      description: "Run an existing plan by id.",
      parameters: Type.Object({
        planId: Type.String({ description: "Id of the plan to run." }),
      }),
      execute: async (args) => {
        const planId = String(args.planId);
        const plan = deps.planStore.load(planId);
        if (!plan) return { ok: false, error: "plan_not_found" };
        const updated = await deps.planRunner.runPlan(plan);
        return { ok: true, planId: updated.id, status: updated.status };
      },
    },
    {
      name: "plan_status",
      description: "Get the status of a plan. If planId is omitted, returns the active plan for the current session.",
      parameters: Type.Object({
        planId: Type.Optional(Type.String({ description: "Plan id. Omit for active plan." })),
      }),
      execute: async (args) => {
        if (args.planId) {
          const plan = deps.planStore.load(String(args.planId));
          return plan
            ? { ok: true, planId: plan.id, status: plan.status, goal: plan.goal }
            : { ok: false, error: "plan_not_found" };
        }
        const sessionId = deps.getCurrentSessionId();
        if (!sessionId) return { ok: false, error: "no current session" };
        const active = deps.planStore.loadActiveForSession(sessionId);
        return active
          ? { ok: true, planId: active.id, status: active.status, goal: active.goal }
          : { ok: false, error: "no_active_plan" };
      },
    },
    {
      name: "plan_list",
      description: "List plans for the current session.",
      parameters: Type.Object({}),
      execute: async () => {
        const sessionId = deps.getCurrentSessionId();
        if (!sessionId) return { ok: false, error: "no current session" };
        const plans = deps.planStore.loadBySession(sessionId);
        return {
          ok: true,
          plans: plans.map((p) => ({ planId: p.id, status: p.status, goal: p.goal })),
        };
      },
    },
  ];
}
