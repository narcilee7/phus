// apps/gui/src/renderer/src/ipc/hooks.ts
// React hooks around the push IPC channels. Each hook takes a stable
// callback and subscribes once on mount, returning an unsubscribe fn from
// useEffect so React handles cleanup correctly under StrictMode.

import { useEffect } from "react";
import { phus } from "./types.js";
import type {
  AgentEventMsg,
  MainErrorMsg,
  OutboundMsg,
  PermissionRequestPayload,
  PlanEventMsg,
  WizardShowMsg,
} from "../../../shared/ipc-schema.js";

/** Subscribe to every Phus AgentEvent (text deltas, tool calls, tool
 *  results, …). Caller usually runs `eventToAction(event)` on the payload. */
export function useAgentEvents(onEvent: (msg: AgentEventMsg) => void): void {
  useEffect(() => {
    return phus.onAgentEvent(onEvent);
  }, [onEvent]);
}

/** Subscribe to plan lifecycle events (step started / completed / failed,
 *  subagent spawned, plan paused/resumed/cancelled/completed). */
export function usePlanEvents(onEvent: (msg: PlanEventMsg) => void): void {
  useEffect(() => {
    return phus.onPlanEvent(onEvent);
  }, [onEvent]);
}

/** Subscribe to Outbound[] broadcasts — the final per-turn reply the
 *  agent decides to send. Render these as the assistant's last message. */
export function useOutbound(onOutbound: (msg: OutboundMsg) => void): void {
  useEffect(() => {
    return phus.onOutbound(onOutbound);
  }, [onOutbound]);
}

/** Subscribe to permission requests. The renderer opens a modal, then
 *  calls `phus.resolvePermission({ requestId, allow, scope })`. */
export function usePermissionRequest(
  onRequest: (req: PermissionRequestPayload) => void,
): void {
  useEffect(() => {
    return phus.onPermissionRequest(onRequest);
  }, [onRequest]);
}

/** Subscribe to wizard visibility — main asks the renderer to show the
 *  bootstrap or key wizard. */
export function useWizardShow(onShow: (msg: WizardShowMsg) => void): void {
  useEffect(() => {
    return phus.onWizardShow(onShow);
  }, [onShow]);
}

/** Subscribe to main-process errors. Useful for surfacing fatal issues
 *  (loadConfig failed, PhusAgent failed to start, etc.). */
export function useMainError(onError: (msg: MainErrorMsg) => void): void {
  useEffect(() => {
    return phus.onMainError(onError);
  }, [onError]);
}