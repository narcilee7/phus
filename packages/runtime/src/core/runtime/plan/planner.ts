// packages/runtime/src/core/runtime/plan/planner.ts
// Planner — builds a goal prompt and parses a JSON-step plan out of the
// model's reply. Uses the injected `CorePort.complete` for the LLM
// call (no @mariozechner/pi-agent-core import here).

import { asSessionId } from "@phus/core/types/brand.js";
import { type Plan, type PlannerDeps, type PlanPhase, type Step } from "./types";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";
import { stripJson } from "@phus/core/utils/json.js";

const PHASES: PlanPhase[] = ["inspect", "edit", "test", "repair"];

export class Planner {
	constructor(private deps: PlannerDeps) {}

	async createPlan(goal: string, sessionId: string, context?: string): Promise<Plan> {
		const text = this.buildPromptText(goal, context);
		let response = "";
		try {
			const result = await this.deps.port.complete([
				{ role: "user", content: text },
			]);
			response = result.text;
		} catch (err: any) {
			response = "";
		}

		const steps = this.parseSteps(response, goal, context);
		const plan: Plan = {
			id: crypto.randomUUID(),
			sessionId: asSessionId(sessionId),
			goal,
			status: "pending",
			steps,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		if (this.deps.hooks) {
			await this.deps.hooks.execute(
				"plan_created",
				makeCtx({
					sessionId: asSessionId(sessionId),
					skills: this.deps.skills,
					extras: { plan },
				}),
				"broadcast",
			);
		}

		return plan;
	}

	private buildPromptText(goal: string, context?: string): string {
		const parts = [
			"You are a task planner. Given a goal and available skills, output a JSON object with a top-level \"steps\" array.",
			"Each step must have: id (unique string), description (string), phase (optional inspect|edit|test|repair), tool (optional tool/skill name), expectedOutput (optional string), dependsOn (optional array of step ids).",
			"Use phase=inspect to gather context, edit to change code, test to validate behavior, and repair to fix a failed step with updated context.",
			"Steps should be concrete, actionable, and ordered by dependency. Output only the JSON object, no markdown fences.",
			"",
			`Goal: ${goal}`,
		];
		if (context) {
			parts.push(`Context: ${context}`);
		}
		parts.push("");
		parts.push("Available skills:");
		parts.push(this.deps.skills.toPromptContext());

		return parts.join("\n");
	}

	private parseSteps(response: string, goal: string, context?: string): Step[] {
		const cleaned = stripJson(response);
		try {
			const parsed = JSON.parse(cleaned) as { steps?: Array<Partial<Step>> };
			if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
				return parsed.steps.map((raw, idx) => this.normalizeStep(raw, idx));
			}
		} catch {
			// fall through to single-step fallback
		}
		return [this.normalizeStep({ description: goal, expectedOutput: context }, 0)];
	}

	private normalizeStep(raw: Partial<Step>, index: number): Step {
		const description = raw.description ?? "";
		return {
			id: raw.id ?? crypto.randomUUID(),
			index,
			description,
			tool: raw.tool,
			expectedOutput: raw.expectedOutput,
			status: "pending",
			retryCount: 0,
			dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn : undefined,
			phase: this.normalizePhase(raw.phase, description),
		};
	}

	private normalizePhase(raw: unknown, description: string): PlanPhase {
		if (typeof raw === "string" && PHASES.includes(raw as PlanPhase)) {
			return raw as PlanPhase;
		}
		return this.inferPhase(description);
	}

	private inferPhase(text: string): PlanPhase {
		const normalized = text.toLowerCase();
		if (/(inspect|read|scan|analy[sz]e|investigate|trace|understand|gather|survey|discover)/.test(normalized)) {
			return "inspect";
		}
		if (/(test|verify|validate|check|assert|smoke)/.test(normalized)) {
			return "test";
		}
		if (/(repair|fix|debug|patch|recover|restore|resolve)/.test(normalized)) {
			return "repair";
		}
		if (/(edit|write|change|update|implement|patch|modify|refactor|add|remove)/.test(normalized)) {
			return "edit";
		}
		return "edit";
	}
}
