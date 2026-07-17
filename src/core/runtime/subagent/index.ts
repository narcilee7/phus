import { asSessionId } from "@/types/brand";
import { SubAgentOptions } from "../plan/types";
import { SubAgentAgentLike } from "./types";
import { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { extractText } from "@/utils/pi-text";

export class SubAgent {
  constructor(private deps: { agent: SubAgentAgentLike }) {}

  private buildSubSessionId(parentSessionId: string) {
    return asSessionId(`${parentSessionId}:sub:${Date.now()}`);
  }

  async run(options: SubAgentOptions): Promise<unknown> {
    const parentSessionId = options.parentSessionId;
    const subSessionId = this.buildSubSessionId(parentSessionId);
    const previousSessionId = this.deps.agent.getCurrentSessionId();

    const capturedMessages: AgentMessage[] = [];
    const unsubscribe = this.deps.agent.subscribeToAgentEvents((event: AgentEvent) => {
      if (event.type === "agent_end") {
        capturedMessages.push(...event.messages);
      }
    });

    try {
      this.deps.agent.setNextSessionId(subSessionId);

      const taskText = options.context
        ? `${options.task}\n\nContext: ${options.context}`
        : options.task;

      this.deps.agent.steer({
        role: "user",
        content: [{ type: "text", text: taskText }],
        timestamp: Date.now(),
      });

      await this.deps.agent.waitForIdle();

      const lastAssistant = [...capturedMessages]
        .reverse()
        .find((m) => m.role === "assistant");
      return extractText(lastAssistant);
    } finally {
      unsubscribe();
      if (previousSessionId) {
        this.deps.agent.setNextSessionId(previousSessionId);
      }
    }
  }
}
