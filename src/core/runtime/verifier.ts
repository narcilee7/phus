import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Step, VerificationResult } from "@/core/runtime/plan/types.js";

export interface VerifierDeps {
  model?: { prompt(messages: AgentMessage[]): Promise<string> };
}

export class Verifier {
  constructor(private deps: VerifierDeps = {}) {}

  async verify(step: Step, result: unknown): Promise<VerificationResult> {
    if (!step.expectedOutput || !this.deps.model) {
      return this.lightweightVerify(result);
    }

    const prompt = this.buildPrompt(step, result);
    try {
      const response = await this.deps.model.prompt(prompt);
      const parsed = this.parseResult(response);
      if (parsed) return parsed;
    } catch {
      // fall back to lightweight verification
    }
    return this.lightweightVerify(result);
  }

  private lightweightVerify(result: unknown): VerificationResult {
    if (result instanceof Error) {
      return {
        ok: false,
        confidence: 0,
        reason: result.message,
        action: "retry",
      };
    }
    const ok = result !== undefined && result !== null && result !== false && result !== "";
    return ok
      ? {
          ok: true,
          confidence: 0.5,
          reason: "result is truthy",
          action: "proceed",
        }
      : {
          ok: false,
          confidence: 0.5,
          reason: "result is falsy",
          action: "retry",
        };
  }

  private buildPrompt(step: Step, result: unknown): AgentMessage[] {
    const actual = result instanceof Error ? result.message : JSON.stringify(result);
    const text = [
      "You are a verifier. Compare the expected output of a step with the actual result and decide what to do next.",
      "Output JSON with fields: ok (boolean), confidence (0-1 number), reason (string), action (one of: proceed, retry, replan, escalate, abort).",
      "",
      `Step: ${step.description}`,
      `Expected output: ${step.expectedOutput}`,
      `Actual result: ${actual}`,
    ].join("\n");

    return [
      {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      },
    ];
  }

  private parseResult(response: string): VerificationResult | undefined {
    const cleaned = response.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
    try {
      const parsed = JSON.parse(cleaned) as Partial<VerificationResult>;
      if (
        typeof parsed.ok === "boolean" &&
        typeof parsed.action === "string" &&
        ["proceed", "retry", "replan", "escalate", "abort"].includes(parsed.action)
      ) {
        return {
          ok: parsed.ok,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          reason: String(parsed.reason ?? ""),
          action: parsed.action as VerificationResult["action"],
        };
      }
    } catch {
      // malformed model output
    }
    return undefined;
  }
}
