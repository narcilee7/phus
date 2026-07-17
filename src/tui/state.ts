// src/tui/state.ts
// ChatItem type + state reducer for the TUI.
// Pure data + transitions; no React, no agent.

export type ChatItemKind = "user" | "assistant" | "tool_call" | "tool_result" | "system";
export type SystemLevel = "info" | "warn" | "error";
export type RememberChoice = "once" | "session" | "always";

export interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
}

export interface ChatItem {
  id: string;
  kind: ChatItemKind;
  ts: number;
  text?: string;
  reasoning?: string;
  isStreaming?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  level?: SystemLevel;
  /** Model that produced this assistant message, if known. */
  model?: string;
  /** Token usage / cost for this assistant message, if reported. */
  usage?: UsageMetadata;
}

export interface ScrollState {
  /** Items from the bottom we are scrolled up. 0 means pinned to bottom. */
  offset: number;
  /** True when new content arrived while scrolled up. */
  hasNew: boolean;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  args: unknown;
  toolCallId: string;
  /** Optional human-readable preview shown above the Y/S/A/N buttons.
   *  Used by `memory_write` to render a diff before approval. */
  preview?: string;
  /** Short caption (e.g. "append 'Style' section", "replace memory"). */
  caption?: string;
  resolve: (allow: boolean) => void;
}

export interface PlanState {
  id: string;
  goal: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  steps: Array<{
    id: string;
    description: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
  }>;
  currentStepId?: string;
}

export interface AppState {
  items: ChatItem[];
  busy: boolean;
  showHint: boolean;
  lastOp: string;
  scroll: ScrollState;
  permissionQueue: PermissionRequest[];
  allowedTools: Set<string>;
  /** Tools allowed for the current session only (cleared on /new). */
  sessionAllowedTools: Set<string>;
  /** Active plan, if any. Updated from plan_runner hook events. */
  plan?: PlanState;
}

export const initialState: AppState = {
  items: [],
  busy: false,
  showHint: true,
  lastOp: "idle",
  scroll: { offset: 0, hasNew: false },
  permissionQueue: [],
  allowedTools: new Set(),
  sessionAllowedTools: new Set(),
  plan: undefined,
};

export type AppAction =
  | { type: "append_delta"; delta: string }
  | { type: "append_thinking"; delta: string }
  | { type: "upsert_tool_call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "complete_tool_call"; toolCallId: string; result: unknown; isError: boolean }
  | { type: "finalize_streaming" }
  | { type: "set_assistant_metadata"; model?: string; usage?: UsageMetadata }
  | { type: "add_user"; text: string }
  | { type: "add_system"; text: string; level: SystemLevel }
  | { type: "set_busy"; busy: boolean }
  | { type: "set_last_op"; op: string }
  | { type: "hide_hint" }
  | { type: "clear_items" }
  | { type: "scroll_up"; lines?: number }
  | { type: "scroll_down"; lines?: number }
  | { type: "scroll_bottom" }
  | { type: "push_permission"; request: PermissionRequest }
  | { type: "resolve_permission"; allow: boolean; remember?: RememberChoice }
  | { type: "clear_session_allowed_tools" }
  | { type: "set_plan"; plan: PlanState }
  | { type: "update_plan_step"; stepId: string; status: PlanState["steps"][number]["status"] }
  | { type: "clear_plan" };

/** Truncate a string for compact display. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** When the user has scrolled up and new content arrives, mark it so the
 *  TUI can show a "new messages" indicator without auto-jumping to bottom. */
function withScrollOnNewContent(state: AppState): AppState {
  if (state.scroll.offset === 0) return state;
  return { ...state, scroll: { ...state.scroll, hasNew: true } };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "append_delta": {
      if (!action.delta) return state;
      const last = state.items[state.items.length - 1];
      if (last && last.kind === "assistant" && last.isStreaming) {
        return withScrollOnNewContent({
          ...state,
          items: [
            ...state.items.slice(0, -1),
            { ...last, text: (last.text ?? "") + action.delta },
          ],
        });
      }
      return withScrollOnNewContent({
        ...state,
        items: [
          ...state.items,
          {
            id: crypto.randomUUID(),
            kind: "assistant",
            ts: Date.now(),
            text: action.delta,
            isStreaming: true,
          },
        ],
      });
    }
    case "append_thinking": {
      if (!action.delta) return state;
      const last = state.items[state.items.length - 1];
      if (last && last.kind === "assistant" && last.isStreaming) {
        return withScrollOnNewContent({
          ...state,
          items: [
            ...state.items.slice(0, -1),
            { ...last, reasoning: (last.reasoning ?? "") + action.delta },
          ],
        });
      }
      return withScrollOnNewContent({
        ...state,
        items: [
          ...state.items,
          {
            id: crypto.randomUUID(),
            kind: "assistant",
            ts: Date.now(),
            reasoning: action.delta,
            isStreaming: true,
          },
        ],
      });
    }
    case "upsert_tool_call": {
      const existing = state.items.find(
        (it) => it.kind === "tool_call" && it.toolCallId === action.toolCallId,
      );
      if (existing) {
        return withScrollOnNewContent({
          ...state,
          items: state.items.map((it) =>
            it.id === existing.id ? { ...it, args: action.args } : it,
          ),
        });
      }
      return withScrollOnNewContent({
        ...state,
        items: [
          ...state.items,
          {
            id: crypto.randomUUID(),
            kind: "tool_call",
            ts: Date.now(),
            toolName: action.toolName,
            toolCallId: action.toolCallId,
            args: action.args,
          },
        ],
      });
    }
    case "complete_tool_call": {
      const callIdx = state.items.findIndex(
        (it) => it.kind === "tool_call" && it.toolCallId === action.toolCallId,
      );
      if (callIdx === -1) return state;
      const call = state.items[callIdx]!;
      const updated = [...state.items];
      updated[callIdx] = { ...call, isError: action.isError };
      updated.splice(callIdx + 1, 0, {
        id: crypto.randomUUID(),
        kind: "tool_result",
        ts: Date.now(),
        toolCallId: action.toolCallId,
        toolName: call.toolName,
        result: action.result,
        isError: action.isError,
      });
      return withScrollOnNewContent({ ...state, items: updated });
    }
    case "finalize_streaming":
      return {
        ...state,
        items: state.items.map((it) =>
          it.kind === "assistant" && it.isStreaming ? { ...it, isStreaming: false } : it,
        ),
      };
    case "set_assistant_metadata": {
      const idx = state.items.map((it) => it.kind).lastIndexOf("assistant");
      if (idx === -1) return state;
      const updated = [...state.items];
      updated[idx] = { ...updated[idx]!, model: action.model, usage: action.usage };
      return { ...state, items: updated };
    }
    case "add_user":
      return withScrollOnNewContent({
        ...state,
        items: [
          ...state.items,
          { id: crypto.randomUUID(), kind: "user", text: action.text, ts: Date.now() },
        ],
      });
    case "add_system":
      return withScrollOnNewContent({
        ...state,
        items: [
          ...state.items,
          {
            id: crypto.randomUUID(),
            kind: "system",
            text: action.text,
            ts: Date.now(),
            level: action.level,
          },
        ],
      });
    case "set_busy":
      return { ...state, busy: action.busy };
    case "set_last_op":
      return { ...state, lastOp: action.op };
    case "hide_hint":
      return { ...state, showHint: false };
    case "clear_items":
      return { ...state, items: [], scroll: { offset: 0, hasNew: false } };
    case "scroll_up": {
      const lines = action.lines ?? 1;
      return { ...state, scroll: { ...state.scroll, offset: state.scroll.offset + lines } };
    }
    case "scroll_down": {
      const lines = action.lines ?? 1;
      return { ...state, scroll: { ...state.scroll, offset: Math.max(0, state.scroll.offset - lines) } };
    }
    case "scroll_bottom":
      return { ...state, scroll: { offset: 0, hasNew: false } };
    case "push_permission":
      return { ...state, permissionQueue: [...state.permissionQueue, action.request] };
    case "resolve_permission": {
      const [first, ...rest] = state.permissionQueue;
      if (!first) return state;
      first.resolve(action.allow);
      const remember = action.remember ?? "once";
      const newState: AppState = { ...state, permissionQueue: rest };
      if (!action.allow || remember === "once") {
        return newState;
      }
      if (remember === "always") {
        newState.allowedTools = new Set([...state.allowedTools, first.toolName]);
      } else if (remember === "session") {
        newState.sessionAllowedTools = new Set([...state.sessionAllowedTools, first.toolName]);
      }
      return newState;
    }
    case "clear_session_allowed_tools":
      return { ...state, sessionAllowedTools: new Set() };
    case "set_plan":
      return { ...state, plan: action.plan };
    case "update_plan_step": {
      if (!state.plan) return state;
      return {
        ...state,
        plan: {
          ...state.plan,
          steps: state.plan.steps.map((s) =>
            s.id === action.stepId ? { ...s, status: action.status } : s,
          ),
          currentStepId: action.status === "running" ? action.stepId : state.plan.currentStepId,
        },
      };
    }
    case "clear_plan":
      return { ...state, plan: undefined };
  }
}