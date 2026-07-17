import { asSessionId } from "@/types/brand";
import { type PlanPhase, type SubAgentOptions } from "../plan/types";
import { SubAgentAgentLike } from "./types";
import { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { extractText } from "@/utils/pi-text";

const PHASE_GUIDANCE: Record<PlanPhase, string> = {
  inspect: "Inspect the relevant code, config, and tests before changing anything.",
  edit: "Make the smallest targeted code change that addresses the task.",
  test: "Run or update tests and report the concrete result.",
  repair: "Use the failure context to diagnose and fix the exact cause.",
};

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
      const taskText = this.buildTaskText(options);

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

  private buildTaskText(options: SubAgentOptions): string {
    const phase = options.phase ?? "edit";
    const parts = [
      `Phase: ${phase}`,
      PHASE_GUIDANCE[phase],
      `Task: ${options.task}`,
    ];

    if (options.context) {
      parts.push(`Context: ${options.context}`);
    }

    if (options.repairContext) {
      parts.push(`Repair context: ${options.repairContext}`);
    }

    return parts.join("\n\n");
  }
}
