// packages/runtime/src/core/runtime/evolution/learner.ts
// Learner — reflects on a session and surfaces a reusable procedure.
// LLM call goes through the injected `port: CorePort`.

import { SessionId } from "@/types/brand";
import { LearnerDeps, Reflection } from "./types";
import { SkillDraft } from "@/infra/skills/draft";

export class Learner {
	constructor(private deps: LearnerDeps) {}

	async reflect(
		sessionId: SessionId,
		task: string,
		outcome?: Reflection["outcome"],
	): Promise<Reflection> {
		const entries = this.collectEntries(sessionId);
		const text = this.buildPromptText(sessionId, task, outcome, entries);

		const response = await this.deps.port.complete([
			{ role: "user", content: text },
		]);

		const parsed = this.parseResponse(response.text, sessionId, task);
		return parsed;
	}

	private collectEntries(sessionId: SessionId): unknown[] {
		const out: unknown[] = [];
		for (const entry of this.deps.tape.replay(sessionId)) {
			out.push(entry);
		}
		return out;
	}

	private buildPromptText(
		sessionId: SessionId,
		task: string,
		outcome: Reflection["outcome"] | undefined,
		entries: unknown[],
	): string {
		const recent = entries.slice(-20);
		const outcomeHint = outcome
			? `The known outcome is: ${outcome}.`
			: "Infer the outcome from the tape entries.";

		return [
			"You are a reflective learner. Analyze the session tape below and produce a structured reflection.",
			"",
			`Task: ${task}`,
			`Session: ${sessionId}`,
			outcomeHint,
			"",
			"Output a JSON object with these fields:",
			'- "outcome": one of "success", "partial", "failure"',
			'- "whatWorked": array of short strings describing what went well',
			'- "whatFailed": array of short strings describing problems, errors, or gaps',
			'- "reusableProcedure": a reusable step-by-step procedure with three sections:',
			'    - Preconditions: when should this procedure apply?',
			'    - Steps: numbered actions, each small enough to verify',
			'    - Failure modes: what could go wrong and how to recover',
			'    If no procedure is reusable, return an empty string ("").',
			'- "procedureConfidence": number 0..1 — how confident you are the procedure is reusable beyond this single task',
			'- "suggestedSkill": optional object with { name, description, body, trigger }. Only include when the procedure is general enough to become a reusable skill (confidence >= 0.7).',
			"",
			"Always populate reusableProcedure when there is at least one repeating pattern, even if small. " +
				"Prefer short, copy-pasteable procedures over long narratives.",
			"",
			"Available skills:",
			this.deps.skills.toPromptContext(),
			"",
			"Recent tape entries:",
			JSON.stringify(recent, null, 2),
			"",
			"Output only the JSON object, no markdown fences.",
		].join("\n");
	}

	private parseResponse(response: string, sessionId: SessionId, task: string): Reflection {
		const cleaned = response.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
		const fallback: Reflection = {
			sessionId,
			task,
			outcome: "partial",
			whatWorked: [],
			whatFailed: ["could not parse learner response"],
			procedureConfidence: 0,
		};

		try {
			const parsed = JSON.parse(cleaned) as Partial<Reflection> & {
				suggestedSkill?: Partial<SkillDraft>;
			};
			const suggestedSkill = this.normalizeSkillDraft(parsed.suggestedSkill, sessionId);
			const explicitProcedure =
				typeof parsed.reusableProcedure === "string" && parsed.reusableProcedure.trim()
					? parsed.reusableProcedure.trim()
					: undefined;

			// If the model didn't write an explicit procedure but did list reusable patterns
			// in whatWorked, synthesize a minimal one. Keeps the evolution loop useful
			// even on shallow reflections.
			const synthesized =
				explicitProcedure ?? this.synthesizeProcedure(parsed.whatWorked, parsed.whatFailed);
			const confidence = this.normalizeConfidence(parsed.procedureConfidence, !!synthesized);

			return {
				sessionId,
				task,
				outcome: this.normalizeOutcome(parsed.outcome),
				whatWorked: this.normalizeStringArray(parsed.whatWorked),
				whatFailed: this.normalizeStringArray(parsed.whatFailed),
				reusableProcedure: synthesized,
				procedureConfidence: confidence,
				suggestedSkill: confidence >= 0.7 ? suggestedSkill : undefined,
			};
		} catch {
			return fallback;
		}
	}

	private synthesizeProcedure(worked: unknown, failed: unknown): string | undefined {
		const ws = this.normalizeStringArray(worked);
		const fs = this.normalizeStringArray(failed);
		if (ws.length === 0 && fs.length === 0) return undefined;

		const steps = ws.length > 0
			? ws.map((w, i) => `${i + 1}. ${w}`).join("\n")
			: "1. Re-investigate before retrying.";

		const failures = fs.length > 0 ? fs.map((f) => `- ${f}`).join("\n") : "- (none observed)";

		return [
			"Preconditions: derived from a single completed task; verify before reuse.",
			"Steps:",
			steps,
			"Failure modes:",
			failures,
		].join("\n");
	}

	private normalizeConfidence(raw: unknown, hasProcedure: boolean): number {
		if (typeof raw === "number" && Number.isFinite(raw)) {
			return Math.max(0, Math.min(1, raw));
		}
		if (typeof raw === "string") {
			const n = Number(raw);
			if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
		}
		// Fallback: any procedure gets a low baseline confidence.
		return hasProcedure ? 0.3 : 0;
	}

	private normalizeOutcome(raw: unknown): Reflection["outcome"] {
		if (raw === "success" || raw === "partial" || raw === "failure") return raw;
		return "partial";
	}

	private normalizeStringArray(raw: unknown): string[] {
		if (!Array.isArray(raw)) return [];
		return raw.filter((x): x is string => typeof x === "string");
	}

	private normalizeSkillDraft(
		raw: Partial<SkillDraft> | undefined,
		sessionId: SessionId,
	): SkillDraft | undefined {
		if (!raw) return undefined;
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		const description = typeof raw.description === "string" ? raw.description.trim() : "";
		const body = typeof raw.body === "string" ? raw.body.trim() : "";
		if (!name || !description || !body) return undefined;

		return {
			name,
			description,
			body,
			trigger: typeof raw.trigger === "string" ? raw.trigger.trim() : `Use when the task resembles: ${description}`,
			sourceSessionId: typeof raw.sourceSessionId === "string" ? raw.sourceSessionId : sessionId,
			verified: false,
			version: typeof raw.version === "string" ? raw.version : "0.1.0-draft",
			createdAt: Date.now(),
		};
	}
}
