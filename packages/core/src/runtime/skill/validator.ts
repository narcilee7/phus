import fs from "node:fs";
import path from "node:path";

import { PlanStore, ValidationMetrics } from "../../session/plan-store.js";
import { LoggerLike, noopLogger } from "../../types/logger/index.js";

/**
 * Minimal `Plan` shape that the validator needs. Defined structurally
 * here so the validator stays independent of any concrete runtime module.
 */
export interface ValidatorPlanLike {
	steps: Array<{ status: string }>;
	status: string;
}

/** Structural type for the plan-runner dependency. Runtime passes its
 *  concrete `PlanRunner`; we only call `createAndRun`. */
export interface ValidatorRunnerLike {
	createAndRun(task: string, sessionId: string): Promise<ValidatorPlanLike>;
}

/** Structural type for the skill-registry dependency. We only call the
 *  methods the validator needs. */
export interface ValidatorSkillRegistryLike {
	getDraft(name: string): SkillDraftLike | undefined;
	get(name: string): { location: string } | undefined;
	delete(name: string): void;
	promoteDraft(name: string): { name: string } | undefined;
	archiveDraft(name: string): void;
	writeDraft(draft: SkillDraftLike): void;
	discover(): void;
}

/** Minimal draft shape — matches `SkillDraft` in `@phus/runtime/infra/skills/draft.js`. */
export interface SkillDraftLike {
	name: string;
	description: string;
	body: string;
	trigger?: string;
	sourceSessionId?: string;
	verified: boolean;
	version?: string;
}

export interface SkillValidatorDeps {
	planRunner: ValidatorRunnerLike;
	planStore: PlanStore;
	skills: ValidatorSkillRegistryLike;
	logger?: LoggerLike;
}

export class SkillValidator {
	private readonly deps: SkillValidatorDeps;
	private readonly logger: LoggerLike;

	constructor(deps: SkillValidatorDeps) {
		this.deps = deps;
		this.logger = deps.logger ?? noopLogger;
	}

	/**
	 * Validate a draft skill by temporarily promoting it, running the task,
	 * and comparing the result to the stored baseline. If no baseline exists,
	 * records one and returns pending_validation.
	 */
	async validate(
		draftName: string,
		task: string,
		sessionId: string,
	): Promise<{ improved: boolean; reason: string }> {
		const draft = this.deps.skills.getDraft(draftName);
		if (!draft) return { improved: false, reason: "draft not found" };

		const existing = this.deps.skills.get(draftName);
		const backupDir = existing ? `${existing.location}.__phus_backup` : undefined;

		if (existing && backupDir) {
			fs.cpSync(existing.location, backupDir, { recursive: true });
			this.deps.skills.delete(draftName);
		}

		// Temporarily promote the draft (moves it from drafts/ to skills/). */
		const promoted = this.deps.skills.promoteDraft(draftName);
		if (!promoted) {
			this.restoreBackup(draft.name, backupDir);
			return { improved: false, reason: "promotion failed" };
		}

		const startedAt = Date.now();
		let plan: ValidatorPlanLike;
		try {
			plan = await this.deps.planRunner.createAndRun(task, sessionId);
		} catch (err) {
			this.demoteDraft(draft, backupDir);
			return {
				improved: false,
				reason: `plan execution failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		const metrics: ValidationMetrics = {
			stepCount: plan.steps.length,
			failures: plan.steps.filter((s) => s.status === "failed" || s.status === "skipped").length,
			durationMs: Date.now() - startedAt,
			status: plan.status === "completed" ? "completed" : "failed",
			recordedAt: Date.now(),
		};

		const baseline = this.deps.planStore.getValidationBaseline(draftName);
		if (!baseline) {
			this.deps.planStore.recordValidationBaseline(draftName, metrics);
			this.deps.planStore.recordValidationAttempt(
				draftName,
				"pending",
				metrics,
				"pending_validation: baseline recorded",
				sessionId,
			);
			this.demoteDraft(draft, backupDir);
			return { improved: false, reason: "pending_validation: baseline recorded" };
		}

		const improved = this.isImproved(metrics, baseline);
		if (improved) {
			this.deps.planStore.recordValidationBaseline(draftName, metrics);
			this.deps.planStore.recordValidationAttempt(
				draftName,
				"improved",
				metrics,
				`improved over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
				sessionId,
			);
			// Leave the skill promoted — the draft is now a validated skill.
			this.removeBackup(backupDir);
			return {
				improved: true,
				reason: `improved over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
			};
		}

		this.deps.planStore.recordValidationAttempt(
			draftName,
			"failed",
			metrics,
			`no improvement over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
			sessionId,
		);
		this.deps.skills.archiveDraft(draftName);
		this.demoteDraft(draft, backupDir);
		return {
			improved: false,
			reason: `no improvement over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
		};
	}

	private isImproved(current: ValidationMetrics, baseline: ValidationMetrics): boolean {
		if (current.status === "completed" && baseline.status !== "completed") return true;
		if (current.status !== "completed" && baseline.status === "completed") return false;
		// Same completion status: fewer failures or comparable failures with fewer steps.
		if (current.failures < baseline.failures) return true;
		if (current.failures === baseline.failures && current.stepCount <= baseline.stepCount) return true;
		return false;
	}

	/** Move the temporarily promoted skill back to drafts and restore any backup. */
	private demoteDraft(draft: SkillDraftLike, backupDir: string | undefined): void {
		this.deps.skills.delete(draft.name);
		this.deps.skills.writeDraft({
			name: draft.name,
			description: draft.description,
			body: draft.body,
			trigger: draft.trigger,
			sourceSessionId: draft.sourceSessionId,
			verified: false,
			version: draft.version,
		});
		this.restoreBackup(draft.name, backupDir);
	}

	private restoreBackup(name: string, backupDir: string | undefined): void {
		if (backupDir && fs.existsSync(backupDir)) {
			const target = path.join(path.dirname(backupDir), name);
			if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
			fs.renameSync(backupDir, target);
			this.deps.skills.discover();
		}
	}

	private removeBackup(backupDir: string | undefined): void {
		if (backupDir && fs.existsSync(backupDir)) {
			fs.rmSync(backupDir, { recursive: true, force: true });
		}
	}
}