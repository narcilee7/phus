import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionId } from "@/types/brand.js";
import type { Plan, Step, VerificationResult } from "@/core/runtime/plan/types.js";
import { Verifier } from "@/core/runtime/verifier.js";
import { SubAgent } from "@/core/runtime/subagent.js";

export class ReplanNeededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplanNeededError";
  }
}

export interface SubAgentAgentLike {
  steer(message: AgentMessage): void;
  waitForIdle(): Promise<void>;
  getCurrentSessionId(): SessionId | undefined;
  setNextSessionId(id: SessionId): void;
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
}

/** @deprecated Use SubAgentAgentLike; kept for compatibility with existing call sites. */
export type ExecutorAgentLike = SubAgentAgentLike;

export interface ExecutorDeps {
  agent: SubAgentAgentLike;
  tools?: Map<string, (args: unknown) => Promise<unknown>>;
  verifier: Verifier;
  maxRetries?: number;
}

export class Executor {
  constructor(private deps: ExecutorDeps) {}

  async executeStep(step: Step, plan: Plan): Promise<{ step: Step; verification: VerificationResult }> {
    const maxRetries = this.deps.maxRetries ?? 2;
    let lastResult: unknown;
    let verification: VerificationResult | undefined;

    while (step.retryCount <= maxRetries) {
      try {
        step.status = "running";
        lastResult = await this.runStep(step, plan);
      } catch (err) {
        lastResult = err instanceof Error ? err : new Error(String(err));
      }

      verification = await this.deps.verifier.verify(step, lastResult);

      if (verification.action === "proceed") {
        step.status = "completed";
        step.result = lastResult;
        return { step, verification };
      }

      if (verification.action === "retry") {
        step.retryCount++;
        continue;
      }

      if (verification.action === "replan") {
        throw new ReplanNeededError(`step ${step.id} requires replanning: ${verification.reason}`);
      }

      // abort or escalate
      throw new Error(`step ${step.id} ${verification.action}: ${verification.reason}`);
    }

    step.status = "failed";
    step.result = lastResult;
    return {
      step,
      verification: verification ?? {
        ok: false,
        confidence: 0,
        reason: "max retries exceeded",
        action: "abort",
      },
    };
  }

  private async runStep(step: Step, plan: Plan): Promise<unknown> {
    if (step.tool && this.deps.tools?.has(step.tool)) {
      const tool = this.deps.tools.get(step.tool)!;
      return tool({ description: step.description, expectedOutput: step.expectedOutput });
    }

    const subAgent = new SubAgent({ agent: this.deps.agent });
    return subAgent.run({
      task: step.description,
      parentSessionId: plan.sessionId,
      context: step.expectedOutput,
    });
  }
}
