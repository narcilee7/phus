// src/tui/handler/commands/plan.ts
// Plan runner wrapper. /plan create <goal> spins up a new plan;
// /plan run|status|list|resume work on existing plans.

import type { CommandRegistry } from "@/handler/commands/context.js";
import { errorMessage, notify } from "@/handler/commands/notice.js";

export function registerPlan(): CommandRegistry {
  return {
    async plan(arg, { agent, dispatch }) {
      const [sub, ...rest] = arg.trim().split(/\s+/);
      const restArg = rest.join(" ").trim();
      const runner = agent.getPlanRunner();
      const store = agent.getPlanStore();

      if (sub === "create") {
        if (!runner) return notify(dispatch, "plan runner not available", "error");
        if (!restArg) return notify(dispatch, "usage: /plan create <goal>", "warn");
        const sid = agent.getCurrentSessionId();
        if (!sid) return notify(dispatch, "no active session", "warn");
        dispatch({ type: "set_last_op", op: "planning…" });
        try {
          const plan = await runner.createAndRun(restArg, sid);
          notify(
            dispatch,
            `plan ${plan.id} ${plan.status} (${plan.steps.length} steps)`,
            plan.status === "completed" ? "info" : "warn",
          );
        } catch (err) {
          notify(dispatch, `plan failed: ${errorMessage(err)}`, "error");
        } finally {
          dispatch({ type: "set_last_op", op: "idle" });
        }
        return;
      }

      if (sub === "run") {
        if (!runner || !store) return notify(dispatch, "plan runner not available", "error");
        const planId = restArg;
        if (!planId) return notify(dispatch, "usage: /plan run <planId>", "warn");
        const plan = store.load(planId);
        if (!plan) return notify(dispatch, `plan not found: ${planId}`, "warn");
        dispatch({ type: "set_last_op", op: "running plan…" });
        try {
          const updated = await runner.runPlan(plan);
          notify(
            dispatch,
            `plan ${updated.id} ${updated.status}`,
            updated.status === "completed" ? "info" : "warn",
          );
        } catch (err) {
          notify(dispatch, `plan failed: ${errorMessage(err)}`, "error");
        } finally {
          dispatch({ type: "set_last_op", op: "idle" });
        }
        return;
      }

      if (sub === "status") {
        if (!store) return notify(dispatch, "plan store not available", "error");
        const sid = agent.getCurrentSessionId();
        if (!sid) return notify(dispatch, "no active session", "warn");
        const active = store.loadActiveForSession(sid);
        if (!active) return notify(dispatch, "no active plan");
        const completed = active.steps.filter((s: { status: string }) => s.status === "completed").length;
        notify(dispatch, `${active.id}: ${active.status} [${completed}/${active.steps.length}] ${active.goal}`);
        return;
      }

      if (sub === "list") {
        if (!store) return notify(dispatch, "plan store not available", "error");
        const sid = agent.getCurrentSessionId();
        if (!sid) return notify(dispatch, "no active session", "warn");
        const plans = store.loadBySession(sid);
        if (plans.length === 0) return notify(dispatch, "(no plans)");
        const lines = plans.map((p: { id: string; status: string; steps: { status: string }[]; goal: string }) => {
          const done = p.steps.filter((s: { status: string }) => s.status === "completed").length;
          return `  ${p.id}  ${p.status}  [${done}/${p.steps.length}]  ${p.goal.slice(0, 60)}`;
        });
        notify(dispatch, lines.join("\n"));
        return;
      }

      if (sub === "resume") {
        if (!runner || !store) return notify(dispatch, "plan runner not available", "error");
        const sid = agent.getCurrentSessionId();
        if (!sid) return notify(dispatch, "no active session", "warn");
        const active = store.loadActiveForSession(sid);
        if (!active) return notify(dispatch, "no active plan", "warn");
        dispatch({ type: "set_last_op", op: "running plan…" });
        try {
          const updated = await runner.runPlan(active);
          notify(
            dispatch,
            `plan ${updated.id} ${updated.status}`,
            updated.status === "completed" ? "info" : "warn",
          );
        } catch (err) {
          notify(dispatch, `plan failed: ${errorMessage(err)}`, "error");
        } finally {
          dispatch({ type: "set_last_op", op: "idle" });
        }
        return;
      }

      notify(dispatch, "usage: /plan create|run|status|list|resume ...", "warn");
    },
  };
}
