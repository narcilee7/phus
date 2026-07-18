// src/tui/hooks/usePlanEvents.ts
// Subscribes to plan-runner events and reflects them into the active
// plan in state. The mapping is opinionated — step events inflate the
// plan on first sight, subsequent events just update status / output /
// subagents.

import { useEffect, type MutableRefObject } from "react";
import type { PhusAgent, PlanEvent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppAction, AppState, PlanState, PlanStepState } from "@/state/state.js";

export function usePlanEvents(
  agent: PhusAgent,
  dispatch: (action: AppAction) => void,
  planRef: MutableRefObject<PlanState | undefined>,
): void {
  useEffect(() => {
    const unsub = agent.subscribeToPlanEvents((event: PlanEvent) => {
      const action = planEventToAction(event, planRef);
      if (action) dispatch(action);
    });
    return unsub;
  }, [agent, dispatch, planRef]);
}

/** Pure mapping — exposed for unit testing. */
export function planEventToAction(
  event: PlanEvent,
  planRef: MutableRefObject<PlanState | undefined>,
): AppAction | null {
  const currentPlan = planRef.current;

  switch (event.type) {
    case "plan_completed":
      return {
        type: "set_plan",
        plan: {
          id: event.planId,
          goal: event.goal,
          status: event.planStatus,
          steps: currentPlan?.id === event.planId ? currentPlan.steps : [],
          subagents: currentPlan?.id === event.planId ? currentPlan.subagents : [],
        },
      };

    case "plan_paused":
    case "plan_resumed":
    case "plan_cancelled":
      return { type: "set_plan_status", status: event.planStatus };

    case "plan_subagent_started":
      if (!event.subagent) return null;
      return {
        type: "upsert_plan_subagent",
        subagent: {
          sessionId: event.subagent.sessionId,
          label: event.subagent.label,
          goal: event.subagent.goal,
          status: "running",
        },
      };

    case "plan_subagent_completed":
      if (!event.subagent?.sessionId) return null;
      {
        const existing = currentPlan?.subagents.find(
          (a) => a.sessionId === event.subagent!.sessionId,
        );
        if (!existing) return null;
        return {
          type: "upsert_plan_subagent",
          subagent: { ...existing, status: "completed" },
        };
      }

    case "plan_step_output": {
      if (!event.step) return null;
      return {
        type: "set_plan_step_output",
        stepId: event.step.id,
        output: event.output ?? "",
      };
    }

    case "plan_step_retry": {
      if (!event.step) return null;
      const prev = currentPlan?.steps.find((s) => s.id === event.step!.id);
      return {
        type: "update_plan_step_meta",
        stepId: event.step.id,
        meta: {
          status: "pending",
          retryCount: ((prev?.retryCount ?? 0) + (event.retryDelta ?? 1)) as PlanStepState["retryCount"],
          error: undefined,
        },
      };
    }
  }

  if (!event.step) return null;

  if (event.type === "plan_step_started") {
    if (currentPlan?.id !== event.planId) {
      return {
        type: "set_plan",
        plan: {
          id: event.planId,
          goal: event.goal,
          status: event.planStatus,
          steps: [{ id: event.step.id, description: event.step.description, status: "running" }],
          currentStepId: event.step.id,
          subagents: [],
        },
      };
    }
    return { type: "update_plan_step", stepId: event.step.id, status: "running" as PlanStepState["status"] };
  }

  const status: PlanStepState["status"] =
    event.type === "plan_step_completed" ? "completed" : "failed";
  return { type: "update_plan_step", stepId: event.step.id, status };
}

// Re-export for callers that want to use the typed ref without importing
// from state.ts directly.
export type { AppState };
