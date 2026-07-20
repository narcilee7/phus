import { PlanRunner } from "@/core/runtime/plan/plan-runner";
import type { InternalCommand, InternalCommandServices } from "../types";
import type { PlanStore } from "@phus/core/session/plan-store.js";

function getPlanRunner(services: InternalCommandServices): PlanRunner | undefined {
  return (services.agent as any).getPlanRunner?.();
}

function getPlanStore(services: InternalCommandServices): PlanStore | undefined {
  return (services.agent as any).getPlanStore?.();
}

export function definePlanCommands(services: InternalCommandServices): InternalCommand[] {
  return [
    {
      name: "plan",
      description: "plan management (create, run, status, list, resume)",
      usage: "create|run|status|list|resume ...",
      handler: async ({ positional }) => {
        const sub = positional[0];
        const rest = positional.slice(1);

        switch (sub) {
          case "create": {
            const runner = getPlanRunner(services);
            if (!runner) return "plan runner not available";
            const goal = rest.join(" ").trim();
            if (!goal) return "usage: ,plan create <goal>";
            const sid = services.agent.getCurrentSessionId();
            if (!sid) return "no active session";
            const plan = await runner.createAndRun(goal, sid);
            return `created plan ${plan.id} (${plan.status})`;
          }
          case "run": {
            const runner = getPlanRunner(services);
            const store = getPlanStore(services);
            if (!runner || !store) return "plan runner not available";
            const planId = rest[0];
            if (!planId) return "usage: ,plan run <planId>";
            const plan = store.load(planId);
            if (!plan) return `plan not found: ${planId}`;
            const updated = await runner.runPlan(plan);
            return `plan ${updated.id} (${updated.status})`;
          }
          case "status": {
            const store = getPlanStore(services);
            if (!store) return "plan store not available";
            const planId = rest[0];
            if (!planId) {
              const sid = services.agent.getCurrentSessionId();
              if (!sid) return "no active session";
              const active = store.loadActiveForSession(sid);
              return active ? `${active.id}: ${active.status}` : "no active plan";
            }
            const plan = store.load(planId);
            return plan ? `${plan.id}: ${plan.status}` : `plan not found: ${planId}`;
          }
          case "list": {
            const store = getPlanStore(services);
            if (!store) return "plan store not available";
            const sid = services.agent.getCurrentSessionId();
            if (!sid) return "no active session";
            const plans = store.loadBySession(sid);
            return plans.length
              ? plans.map((p) => `  ${p.id}  ${p.status}  ${p.goal.slice(0, 60)}`).join("\n")
              : "(no plans)";
          }
          case "resume": {
            const runner = getPlanRunner(services);
            const store = getPlanStore(services);
            if (!runner || !store) return "plan runner not available";
            const sid = services.agent.getCurrentSessionId();
            if (!sid) return "no active session";
            const active = store.loadActiveForSession(sid);
            if (!active) return "no active plan";
            const updated = await runner.runPlan(active);
            return `plan ${updated.id} (${updated.status})`;
          }
          default:
            return "usage: ,plan create|run|status|list|resume ...";
        }
      },
    },
  ];
}
