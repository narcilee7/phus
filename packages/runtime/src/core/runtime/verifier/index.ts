// packages/runtime/src/core/runtime/verifier/index.ts
// Verifier — checks whether a step's actual result matches its
// expected output. Reaches the LLM via the injected `port: CorePort`.

import type { Step, VerificationResult, PlanPhase } from "../plan/types.js";
import type { CorePort } from "@/bridge/core-port.js";

const PHASE_HINTS: Record<PlanPhase, string> = {
	inspect: "For inspect steps, prefer proceed when the result explains the codepath clearly enough to support the next action.",
	edit: "For edit steps, prefer proceed when the change is targeted and consistent with the expected output.",
	test: "For test steps, prefer proceed only when validation evidence is concrete and successful.",
	repair: "For repair steps, prefer retry when the failure points to a fixable cause in the current codepath; replan only when the shape of the task must change.",
};

export interface VerifierDeps {
	port?: CorePort;
}

export class Verifier {
	constructor(private deps: VerifierDeps = {}) {}

	async verify(step: Step, result: unknown): Promise<VerificationResult> {
		if (!step.expectedOutput || !this.deps.port) {
			return this.lightweightVerify(result);
		}

		const text = this.buildPromptText(step, result);
		try {
			const response = await this.deps.port.complete([
				{ role: "user", content: text },
			]);
			const parsed = this.parseResult(response.text);
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

	private buildPromptText(step: Step, result: unknown): string {
		const actual = result instanceof Error ? result.message : JSON.stringify(result);
		const phase = step.phase ?? "edit";
		return [
			"You are a verifier. Compare the expected output of a step with the actual result and decide what to do next.",
			"Output JSON with fields: ok (boolean), confidence (0-1 number), reason (string), action (one of: proceed, retry, replan, escalate, abort).",
			`Phase: ${phase}`,
			PHASE_HINTS[phase],
			"",
			`Step: ${step.description}`,
			`Expected output: ${step.expectedOutput}`,
			step.repairContext ? `Repair context: ${step.repairContext}` : "",
			`Actual result: ${actual}`,
		].join("\n");
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
