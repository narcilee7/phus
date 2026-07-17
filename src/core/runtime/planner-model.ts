import { completeSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractText } from "@/bridge/text.js";

export function createPlannerModel(
  model: Model<any>,
): { prompt(messages: AgentMessage[]): Promise<string> } {
  return {
    prompt: async (messages: AgentMessage[]): Promise<string> => {
      const assistant = await completeSimple(model, { messages: messages as any });
      return extractText(assistant as any);
    },
  };
}
