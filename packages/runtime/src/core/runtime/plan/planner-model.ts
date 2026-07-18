import { extractText } from "@/utils/pi-text";
import { AgentMessage } from "@mariozechner/pi-agent-core";
import { completeSimple, Model } from "@mariozechner/pi-ai"

export const createPlannerModel = (
  model: Model<any>,
): { prompt(messages: AgentMessage[]): Promise<string> } => {
    return {
    prompt: async (messages: AgentMessage[]): Promise<string> => {
      const assistant = await completeSimple(model, { messages: messages as any });
      return extractText(assistant as any);
    },
    }
}
