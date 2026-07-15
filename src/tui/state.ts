// src/tui/state.ts
// ChatItem type + state reducer for the TUI.
// Pure data + transitions; no React, no agent.

export type ChatItemKind = "user" | "assistant" | "tool_call" | "tool_result" | "system";
export type SystemLevel = "info" | "warn" | "error";

export interface ChatItem {
  id: string;
  kind: ChatItemKind;
  ts: number;
  text?: string;
  isStreaming?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  level?: SystemLevel;
}

export interface AppState {
  items: ChatItem[];
  busy: boolean;
  showHint: boolean;
  lastOp: string;
}

export const initialState: AppState = {
  items: [],
  busy: false,
  showHint: true,
  lastOp: "idle",
};

export type AppAction =
  | { type: "append_delta"; delta: string }
  | { type: "upsert_tool_call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "complete_tool_call"; toolCallId: string; result: unknown; isError: boolean }
  | { type: "finalize_streaming" }
  | { type: "add_user"; text: string }
  | { type: "add_system"; text: string; level: SystemLevel }
  | { type: "set_busy"; busy: boolean }
  | { type: "set_last_op"; op: string }
  | { type: "hide_hint" }
  | { type: "clear_items" };

/** Truncate a string for compact display. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "append_delta": {
      if (!action.delta) return state;
      const last = state.items[state.items.length - 1];
      if (last && last.kind === "assistant" && last.isStreaming) {
        return {
          ...state,
          items: [
            ...state.items.slice(0, -1),
            { ...last, text: (last.text ?? "") + action.delta },
          ],
        };
      }
      return {
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
      };
    }
    case "upsert_tool_call": {
      const existing = state.items.find(
        (it) => it.kind === "tool_call" && it.toolCallId === action.toolCallId,
      );
      if (existing) {
        return {
          ...state,
          items: state.items.map((it) =>
            it.id === existing.id ? { ...it, args: action.args } : it,
          ),
        };
      }
      return {
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
      };
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
      return { ...state, items: updated };
    }
    case "finalize_streaming":
      return {
        ...state,
        items: state.items.map((it) =>
          it.kind === "assistant" && it.isStreaming ? { ...it, isStreaming: false } : it,
        ),
      };
    case "add_user":
      return {
        ...state,
        items: [
          ...state.items,
          { id: crypto.randomUUID(), kind: "user", text: action.text, ts: Date.now() },
        ],
      };
    case "add_system":
      return {
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
      };
    case "set_busy":
      return { ...state, busy: action.busy };
    case "set_last_op":
      return { ...state, lastOp: action.op };
    case "hide_hint":
      return { ...state, showHint: false };
    case "clear_items":
      return { ...state, items: [] };
  }
}