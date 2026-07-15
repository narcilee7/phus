// src/bridge/agent-tool-adapter.ts
// Adapt a Phus-side MetaTool into a Pi-side AgentTool.

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MetaTool } from "@/types/tool.js";

/** Convert a MetaTool into an AgentTool. Errors thrown from the
 *  MetaTool are re-thrown so Pi marks the result as `isError` and
 *  feeds it back to the LLM. */
export function toAgentTool(meta: MetaTool): AgentTool {
  return {
    name: meta.name,
    label: meta.name,
    description: meta.description,
    parameters: meta.parameters,
    execute: async (_toolCallId, params) => {
      try {
        const result = await meta.execute(params as Record<string, unknown>);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: any) {
        throw new Error(err?.message ?? String(err));
      }
    },
  };
}