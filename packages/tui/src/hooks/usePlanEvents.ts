// src/tui/hooks/usePlanEvents.ts
// React-era hook. The pure mapping now lives in
// `transform/plan-events.ts` so non-React code (the pi-tui App class)
// can use it without dragging in React's MutableRefObject. This file
// re-exports the pure mapping for backward compatibility with the
// existing tests under test/tui/.

import { useEffect, type MutableRefObject } from "react";
import type { PhusAgent, PlanEvent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppAction, AppState, PlanState } from "@/state/state.js";
import { planEventToAction, type PlanRef } from "@/transform/plan-events.js";

export function usePlanEvents(
  agent: PhusAgent,
  dispatch: (action: AppAction) => void,
  planRef: MutableRefObject<PlanState | undefined>,
): void {
  useEffect(() => {
    const unsub = agent.subscribeToPlanEvents((event: PlanEvent) => {
      const ref: PlanRef = { current: planRef.current };
      const action = planEventToAction(event, ref);
      if (action) dispatch(action);
    });
    return unsub;
  }, [agent, dispatch, planRef]);
}

export { planEventToAction };
export type { PlanRef };
export type { AppState };

