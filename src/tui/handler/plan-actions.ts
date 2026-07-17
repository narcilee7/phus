// src/tui/handler/plan-actions.ts
// Bound plan-action handlers for the TUI. Pause / resume / cancel /
// retry all talk to the agent's plan runner and emit system messages so
// the chat area shows what happened.

import type { PhusAgent } from "@/bridge/pi-agent.js";
import type { AppAction, PlanState, SystemLevel } from "@/tui/state/state.js";

const ID_PREVIEW_CHARS = 8;
const STEP_ID_PREVIEW_CHARS = 6;

/** First 8 chars of an id — short enough for the status pill, long
 *  enough to disambiguate. Shared across all plan notifications. */
function shortId(id: string): string {
  return id.slice(0, ID_PREVIEW_CHARS);
}

type Dispatch = (action: AppAction) => void;

function notify(dispatch: Dispatch, text: string, level: SystemLevel) {
  dispatch({ type: "add_system", text, level });
}

export interface PlanActionHandlers {
  pause(): void;
  resume(): Promise<void>;
  cancel(): void;
  retryStep(stepId: string): void;
}

export function planActions(
  agent: PhusAgent,
  dispatch: Dispatch,
  plan: PlanState | undefined,
): PlanActionHandlers {
  return {
    pause: () => {
      const id = agent.pauseActivePlan();
      if (id) notify(dispatch, `⏸ paused plan ${shortId(id)}`, "info");
    },
    resume: async () => {
      dispatch({ type: "set_last_op", op: "running plan…" });
      try {
        const id = await agent.resumeActivePlan();
        if (id) notify(dispatch, `▶ resumed plan ${shortId(id)}`, "info");
      } finally {
        dispatch({ type: "set_last_op", op: "idle" });
      }
    },
    cancel: () => {
      const id = agent.cancelActivePlan();
      if (id) notify(dispatch, `✗ cancelled plan ${shortId(id)}`, "warn");
    },
    retryStep: (stepId: string) => {
      if (!plan) return;
      const ok = agent.retryStep(plan.id, stepId);
      if (ok) {
        const preview = stepId.slice(0, STEP_ID_PREVIEW_CHARS);
        notify(dispatch, `↻ step ${preview} queued for retry — run /plan resume`, "info");
      }
    },
  };
}
