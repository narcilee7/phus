// apps/gui/src/renderer/src/events/event-to-action.ts
// Map PhusAgent events to AppState transitions. Verbatim port of
// src/tui/events.ts. The Phus runtime never sees this file — it just emits
// AgentEvents through IPC and the renderer is the sole consumer.
//
// We type `event` as `unknown` here (instead of `any`) since this runs in
// the renderer under strict mode and `any` would need a justification
// comment. The narrowing below uses duck-typed checks.

import type { AppAction } from "../state/reducer.js";

/** Convert a Pi Agent event into a state action (or null to ignore).
 *
 *  - message_update + text_delta       → append_delta
 *  - message_update + thinking_delta   → append_thinking
 *  - tool_execution_start              → upsert_tool_call
 *  - tool_execution_end                → complete_tool_call
 *  - agent_end                          → finalize_streaming
 *  - turn_end with errorMessage         → add_system ("error: ...")
 */
export function eventToAction(event: unknown): AppAction | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as { type?: unknown };

  switch (e.type) {
    case "message_update": {
      const ame = (event as { assistantMessageEvent?: { type?: unknown; delta?: unknown } })
        .assistantMessageEvent;
      if (ame?.type === "text_delta") {
        return { type: "append_delta", delta: String(ame.delta ?? "") };
      }
      if (ame?.type === "thinking_delta") {
        return { type: "append_thinking", delta: String(ame.delta ?? "") };
      }
      return null;
    }
    case "tool_execution_start": {
      const x = event as { toolCallId?: unknown; toolName?: unknown; args?: unknown };
      return {
        type: "upsert_tool_call",
        toolCallId: String(x.toolCallId ?? ""),
        toolName: String(x.toolName ?? ""),
        args: x.args,
      };
    }
    case "tool_execution_end": {
      const x = event as { toolCallId?: unknown; result?: unknown; isError?: unknown };
      return {
        type: "complete_tool_call",
        toolCallId: String(x.toolCallId ?? ""),
        result: x.result,
        isError: !!x.isError,
      };
    }
    case "agent_end":
      return { type: "finalize_streaming" };
    case "turn_end": {
      const x = event as {
        message?: {
          errorMessage?: unknown;
          usage?: {
            input?: unknown;
            output?: unknown;
            totalTokens?: unknown;
            cost?: { total?: unknown };
          };
          model?: unknown;
        };
      };
      if (x.message?.errorMessage) {
        return {
          type: "add_system",
          text: `error: ${String(x.message.errorMessage)}`,
          level: "error",
        };
      }
      const usage = x.message?.usage;
      if (usage) {
        return {
          type: "set_assistant_metadata",
          model: typeof x.message?.model === "string" ? x.message.model : undefined,
          usage: {
            inputTokens: typeof usage.input === "number" ? usage.input : undefined,
            outputTokens: typeof usage.output === "number" ? usage.output : undefined,
            totalTokens:
              typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
            cost:
              usage.cost && typeof usage.cost.total === "number"
                ? usage.cost.total
                : undefined,
          },
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Map a PlanEvent to one or more state actions. Most plan events map to a
 *  single reducer action; complex ones (plan_step_started, plan_step_completed)
 *  may need a richer state shape than the current PlanStepState exposes
 *  (status, output, subagentSessionId) and degrade gracefully. */
export function planEventToAction(event: unknown): AppAction | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as {
    type?: unknown;
    planId?: unknown;
    sessionId?: unknown;
    goal?: unknown;
    planStatus?: unknown;
    step?: { id?: unknown; description?: unknown; tool?: unknown };
    output?: unknown;
    error?: unknown;
    subagent?: { sessionId?: unknown; label?: unknown; goal?: unknown };
    retryDelta?: unknown;
  };
  const planId = String(e.planId ?? "");
  const sessionId = String(e.sessionId ?? "");
  const goal = String(e.goal ?? "");
  const status = String(e.planStatus ?? "pending");
  const stepId = typeof e.step?.id === "string" ? e.step.id : undefined;

  switch (e.type) {
    case "plan_step_started":
      // The full plan is built elsewhere (e.g. by /plan in TUI). For now
      // we synthesize a minimal PlanState when planStepStarted arrives.
      // Renderer treats this as best-effort; if a richer Plan already
      // exists in state, the reducer's set_plan / update_plan_step takes
      // over.
      return {
        type: "update_plan_step",
        stepId: stepId ?? "",
        status: "running",
      };
    case "plan_step_completed":
      return stepId
        ? { type: "update_plan_step", stepId, status: "completed" }
        : null;
    case "plan_step_failed":
      return stepId
        ? {
            type: "update_plan_step_meta",
            stepId,
            meta: {
              status: "failed",
              ...(typeof e.error === "string" ? { error: e.error } : {}),
            },
          }
        : null;
    case "plan_step_output":
      return stepId && typeof e.output === "string"
        ? { type: "set_plan_step_output", stepId, output: e.output }
        : null;
    case "plan_step_retry":
      return stepId
        ? {
            type: "update_plan_step_meta",
            stepId,
            meta: {
              retryCount:
                typeof e.retryDelta === "number"
                  ? (e.retryDelta as number)
                  : undefined,
            },
          }
        : null;
    case "plan_subagent_started":
    case "plan_subagent_completed": {
      const sub = e.subagent;
      if (!sub) return null;
      const subagentStatus: "running" | "completed" | "failed" =
        e.type === "plan_subagent_completed" ? "completed" : "running";
      return {
        type: "upsert_plan_subagent",
        subagent: {
          sessionId: String(sub.sessionId ?? ""),
          label: String(sub.label ?? ""),
          goal: String(sub.goal ?? ""),
          status: subagentStatus,
        },
      };
    }
    case "plan_paused":
      return { type: "set_plan_status", status: "paused" };
    case "plan_resumed":
      return { type: "set_plan_status", status: "running" };
    case "plan_cancelled":
      return { type: "set_plan_status", status: "failed" };
    case "plan_completed":
      return { type: "set_plan_status", status: "completed" };
    default:
      return null;
  }

  // Note: planId / sessionId / goal / status are available for richer
  // actions if/when the reducer grows a set_plan path that synthesizes the
  // full Plan from these events.
  void planId;
  void sessionId;
  void goal;
  void status;
}