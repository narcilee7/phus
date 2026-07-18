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

export interface PlanStepState {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  /** Wall-clock time spent in this step, if finished. */
  durationMs?: number;
  /** Error message if the step failed. */
  error?: string;
  /** Number of retries attempted for this step. */
  retryCount?: number;
  /** Subagent session id responsible for this step. */
  subagentSessionId?: string;
  /** Short label for the subagent (e.g. "explore", "verify"). */
  subagentLabel?: string;
  /** Latest intermediate output produced by this step. */
  output?: string;
  /** Tool name this step is exercising, if any. */
  tool?: string;
}

export interface PlanSubagentState {
  sessionId: string;
  label: string;
  goal: string;
  status: "running" | "completed" | "failed";
  /** Brief progress note; refreshed while running. */
  progress?: string;
}

export interface PlanState {
  id: string;
  goal: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  steps: PlanStepState[];
  currentStepId?: string;
  /** Subagents launched by the active plan step, keyed by sessionId. */
  subagents: PlanSubagentState[];
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
  /** Sidebar view requested by the user (e.g. via /subagent). */
  sidebarRequest?: "files" | "sessions";
  /** Plan timeline expand toggle. */
  planExpanded?: boolean;
  /** Set when a slash command (e.g. /quit) requests an exit. The
   *  consume_quit_request handler runs useEffect → exit() so the
   *  unmount path runs cleanly outside the async submit chain. */
  quitRequested?: boolean;
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
  | { type: "update_plan_step"; stepId: string; status: PlanStepState["status"] }
  | { type: "update_plan_step_meta"; stepId: string; meta: Partial<PlanStepState> }
  | { type: "set_plan_step_output"; stepId: string; output: string }
  | { type: "set_plan_status"; status: PlanState["status"] }
  | { type: "upsert_plan_subagent"; subagent: PlanSubagentState }
  | { type: "remove_plan_subagent"; sessionId: string }
  | { type: "request_sidebar"; view: "files" | "sessions" }
  | { type: "consume_sidebar_request" }
  | { type: "clear_plan" }
  | { type: "request_quit" }
  | { type: "consume_quit_request" };

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
      updated[callIdx] = {
        ...call,
        result: action.result,
        isError: action.isError,
        durationMs: Date.now() - call.ts,
      };
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
    case "update_plan_step_meta": {
      if (!state.plan) return state;
      return {
        ...state,
        plan: {
          ...state.plan,
          steps: state.plan.steps.map((s) =>
            s.id === action.stepId ? { ...s, ...action.meta } : s,
          ),
        },
      };
    }
    case "set_plan_step_output": {
      if (!state.plan) return state;
      return {
        ...state,
        plan: {
          ...state.plan,
          steps: state.plan.steps.map((s) =>
            s.id === action.stepId ? { ...s, output: action.output } : s,
          ),
        },
      };
    }
    case "set_plan_status": {
      if (!state.plan) return state;
      return { ...state, plan: { ...state.plan, status: action.status } };
    }
    case "upsert_plan_subagent": {
      if (!state.plan) return state;
      const existing = state.plan.subagents.find((a) => a.sessionId === action.subagent.sessionId);
      const subagents = existing
        ? state.plan.subagents.map((a) =>
            a.sessionId === action.subagent.sessionId ? { ...a, ...action.subagent } : a,
          )
        : [...state.plan.subagents, action.subagent];
      return { ...state, plan: { ...state.plan, subagents } };
    }
    case "remove_plan_subagent": {
      if (!state.plan) return state;
      return {
        ...state,
        plan: {
          ...state.plan,
          subagents: state.plan.subagents.filter((a) => a.sessionId !== action.sessionId),
        },
      };
    }
    case "request_sidebar":
      return { ...state, sidebarRequest: action.view };
    case "consume_sidebar_request": {
      if (!state.sidebarRequest) return state;
      const next: AppState = { ...state };
      delete next.sidebarRequest;
      return next;
    }
    case "clear_plan":
      return { ...state, plan: undefined };
    case "request_quit":
      return { ...state, quitRequested: true };
    case "consume_quit_request": {
      if (!state.quitRequested) return state;
      const next: AppState = { ...state };
      delete next.quitRequested;
      return next;
    }
  }
}