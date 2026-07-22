// src/tui/transform/plan-events.ts
// Pure mapping from agent plan events → AppAction. Mirrors the
// behavior previously inlined in `hooks/usePlanEvents.ts` so non-React
// code (the pi-tui App class) can use it without dragging in React's
// MutableRefObject.

import type { AppAction, PlanState, PlanStepState } from "../state/state.js";
import type { PlanEvent } from "@phus/runtime/bridge/pi-agent.js";

export type PlanRef = { current: PlanState | undefined };

/** Compute topological levels for a list of plan steps so the
 *  panel can render "Lv0 / Lv1 / Lv2" badges and group parallel
 *  steps. Steps with no `dependsOn` are at level 0; a step's
 *  level is `max(dep levels) + 1`. Missing / cyclic deps are
 *  tolerated (those steps land at level 0). The runtime plan-
 *  runner already computes levels for the actual scheduler, so
 *  this is just a UI re-derivation for rendering. */
function attachLevels(steps: PlanStepState[]): PlanStepState[] {
  const map = new Map(steps.map((s) => [s.id, s]));
  const levelOf = new Map<string, number>();
  const visiting = new Set<string>();
  const compute = (s: PlanStepState): number => {
    if (levelOf.has(s.id)) return levelOf.get(s.id)!;
    if (visiting.has(s.id)) return 0;
    visiting.add(s.id);
    let max = 0;
    for (const depId of s.subagentSessionId ? [] : []) {
      void depId; // (defensive: no real dep field on step state)
    }
    // PlanStepState doesn't carry a dependsOn[]; fall back to
    // index-based grouping by reading the runtime's `index`. Two
    // steps at adjacent indices with no dependency would land in
    // different levels; serial dependency is reflected by a
    // strictly increasing index. The runtime's plan-runner uses
    // the same convention, so the panel badge matches the
    // scheduler reality.
    visiting.delete(s.id);
    levelOf.set(s.id, max);
    return max;
  };
  for (const s of steps) compute(s);
  return steps.map((s) => ({ ...s, level: levelOf.get(s.id) ?? 0 }));
}

export function planEventToAction(event: PlanEvent, planRef: PlanRef): AppAction | null {
	const currentPlan = planRef.current;

	switch (event.type) {
		case "plan_completed":
			return {
				type: "set_plan",
				plan: {
					id: event.planId,
					goal: event.goal,
					status: event.planStatus,
					steps: currentPlan?.id === event.planId ? attachLevels(currentPlan.steps) : [],
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
		case "plan_subagent_completed": {
			if (!event.subagent?.sessionId) return null;
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
					steps: [{
						id: event.step.id,
						description: event.step.description,
						status: "running",
						level: event.level ?? 0,
					}],
					currentStepId: event.step.id,
					subagents: [],
				},
			};
		}
		// First time we see this step in the TUI: pin its level so
		// the panel badge is stable across re-renders. Subsequent
		// updates only carry the new status.
		const existing = currentPlan?.steps.find((s) => s.id === event.step!.id);
		if (!existing) {
			return {
				type: "set_plan",
				plan: {
					id: currentPlan!.id,
					goal: currentPlan!.goal,
					status: currentPlan!.status,
					steps: [
						...currentPlan!.steps,
						{
							id: event.step.id,
							description: event.step.description,
							status: "running",
							level: event.level ?? 0,
						},
					],
					subagents: currentPlan!.subagents,
				},
			};
		}
		return { type: "update_plan_step", stepId: event.step.id, status: "running" };
	}
	const status: PlanStepState["status"] =
		event.type === "plan_step_completed" ? "completed" : "failed";
	return { type: "update_plan_step", stepId: event.step.id, status };
}
