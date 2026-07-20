import { type Plan, type PlanPhase, type Step, type VerificationResult } from "@phus/core/runtime/plan/types.js";
import { SubAgent } from "@phus/core/runtime/subagent.js";
import { ReplanNeededError } from "./error";
import { ExecutorDeps } from "./types";

const PHASE_GUIDANCE: Record<PlanPhase, string> = {
  inspect: "Inspect the relevant code, config, and tests first. Explain what matters before changing anything.",
  edit: "Make the smallest targeted code change that satisfies the step.",
  test: "Run or update tests to validate the change and capture concrete failures.",
  repair: "Use the previous failure context to diagnose the issue and patch the exact cause.",
};

function shorten(text: string, max = 600): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

function stringifyResult(result: unknown): string {
  if (result instanceof Error) return result.message;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

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
        step.output = shorten(stringifyResult(lastResult));
        step.repairContext = undefined;
        return { step, verification };
      }

      if (verification.action === "retry") {
        step.retryCount++;
        const originalPhase = step.phase ?? "edit";
        step.phase = "repair";
        step.output = shorten(stringifyResult(lastResult));
        step.repairContext = this.buildRepairContext(originalPhase, step, lastResult, verification);
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
    step.output = shorten(stringifyResult(lastResult));
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
      return tool({
        description: step.description,
        expectedOutput: step.expectedOutput,
        phase: step.phase,
        repairContext: step.repairContext,
      });
    }

    const subAgent = new SubAgent({ agent: this.deps.agent });
    return subAgent.run({
      task: step.description,
      parentSessionId: plan.sessionId,
      context: step.expectedOutput,
      phase: step.phase,
      repairContext: step.repairContext,
    });
  }

  private buildRepairContext(
    originalPhase: PlanPhase,
    step: Step,
    lastResult: unknown,
    verification: VerificationResult,
  ): string {
    return shorten(
      [
        `Phase: ${originalPhase} -> repair`,
        `Original phase guidance: ${PHASE_GUIDANCE[originalPhase]}`,
        `Step: ${step.description}`,
        step.expectedOutput ? `Expected output: ${step.expectedOutput}` : undefined,
        `Last result: ${stringifyResult(lastResult)}`,
        `Verification: ${verification.reason}`,
        "Repair the exact cause, keep the change minimal, and re-run validation.",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    );
  }
}
