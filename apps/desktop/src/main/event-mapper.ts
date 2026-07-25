import type { AgentEvent } from "@mariozechner/pi-agent-core";

/** Mirror of the renderer's AgentMessageChunk shape. Kept local so the
 *  desktop package does not depend on @phus/web's source tree for types. */
export interface AgentMessageChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "status";
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { id: string; output: unknown };
  status?: "connected" | "disconnected" | "idle" | "busy";
  error?: string;
}

/**
 * Convert Pi Agent events to the renderer's AgentMessageChunk format.
 */
export function mapAgentEvent(event: AgentEvent): AgentMessageChunk | null {
  switch (event.type) {
    case "agent_start":
      return { type: "status", status: "busy" };

    case "agent_end":
      return { type: "status", status: "idle" };

    case "turn_start":
      return { type: "status", status: "busy" };

    case "message_update": {
      const ame = event.assistantMessageEvent;
      if (ame?.type === "text_delta") {
        return { type: "text", content: String(ame.delta ?? "") };
      }
      return null;
    }

    case "tool_execution_start": {
      return {
        type: "tool_call",
        toolCall: {
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.args ?? {},
        },
      };
    }

    case "tool_execution_end": {
      return {
        type: "tool_result",
        toolResult: {
          id: event.toolCallId,
          output: event.result,
        },
      };
    }

    case "turn_end": {
      if (event.message && "errorMessage" in event.message && event.message.errorMessage) {
        return {
          type: "error",
          error: String(event.message.errorMessage),
        };
      }
      return { type: "status", status: "idle" };
    }

    default:
      return null;
  }
}
