// src/tui/events.ts
// Map PhusAgent events to AppState transitions.

import type { AppAction } from "@/tui/state.js";

/** Convert a Pi Agent event into a state action (or null to ignore).
 *
 *  - message_update + text_delta       → append_delta
 *  - tool_execution_start              → upsert_tool_call
 *  - tool_execution_end                → complete_tool_call
 *  - agent_end                          → finalize_streaming
 *  - turn_end with errorMessage         → add_system ("error: ...")
 */
export function eventToAction(event: any): AppAction | null {
  switch (event.type) {
    case "message_update": {
      const ame = event.assistantMessageEvent;
      if (ame?.type === "text_delta") {
        return { type: "append_delta", delta: String(ame.delta ?? "") };
      }
      if (ame?.type === "thinking_delta") {
        return { type: "append_thinking", delta: String(ame.delta ?? "") };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        type: "upsert_tool_call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case "tool_execution_end":
      return {
        type: "complete_tool_call",
        toolCallId: event.toolCallId,
        result: event.result,
        isError: !!event.isError,
      };
    case "agent_end":
      return { type: "finalize_streaming" };
    case "turn_end":
      if (event.message?.errorMessage) {
        return {
          type: "add_system",
          text: `error: ${event.message.errorMessage}`,
          level: "error",
        };
      }
      return null;
    default:
      return null;
  }
}