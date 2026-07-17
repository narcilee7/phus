import { Step, Plan, VerificationResult } from "@/core/runtime/plan/types";
import { SubAgent } from "@/core/runtime/subagent";
import { ReplanNeededError } from "./error";
import { ExecutorDeps } from "./types";

export class Executor {
  constructor(private deps: ExecutorDeps) {}

  readonly defaultMaxRetries = 3

  async executeStep(step: Step, plan: Plan): Promise<{ step: Step; verification: VerificationResult }> {
    const maxRetries = this.deps.maxRetries ?? this.defaultMaxRetries;
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
