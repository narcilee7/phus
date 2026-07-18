import { extractText } from "@/utils/pi-text";
import { AgentMessage } from "@mariozechner/pi-agent-core";
import { completeSimple, Model } from "@mariozechner/pi-ai"
import { getLlmFuse } from "@/infra/profile.js";

export const createPlannerModel = (
  model: Model<any>,
): { prompt(messages: AgentMessage[]): Promise<string> } => {
    return {
    prompt: async (messages: AgentMessage[]): Promise<string> => {
      // The pre-flight fuse check rides on the model's onPayload (set in
      // modelFromProfile); here we classify failures — a 402 from the
      // planner/verifier/learner opens the billing fuse exactly like one
      // from the main loop.
      try {
        const assistant = await completeSimple(model, { messages: messages as any });
        return extractText(assistant as any);
      } catch (err) {
        getLlmFuse().report(err);
        throw err;
      }
    },
    }
}
