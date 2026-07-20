import type { Plan } from "../plan/types.js";
import type { MemoryAction } from "@/infra/memory/index.js";
import { SkillValidator } from "@phus/core/runtime/skill/validator.js";
import type { SkillDraft } from "@/infra/skills/draft";
import type { TapeEntry } from "@phus/core/types/tape/index.js";
import type { ValidationMetrics } from "@phus/core/session/plan-store.js";
import { logger } from "@/infra/logging.js";
import { EvolutionDeps, Reflection } from "./types";

const PROCEDURE_SECTION = "Procedures";

/** Minimum confidence required to persist a procedure or treat a suggestion as a draft. */
const MIN_PROCEDURE_CONFIDENCE = 0.3;
/** Minimum procedure length (chars) before it's worth persisting. */
const MIN_PROCEDURE_LENGTH = 40;

export class EvolutionEngine {
    readonly skillValidator: SkillValidator;

    constructor(private deps: EvolutionDeps) {
        this.skillValidator = deps.skillValidator;
    }

    /**
     * Called after a plan completes.
     * 1. Reflect on the completed plan.
     * 2. If a reusable procedure is found (confidence >= threshold), write a skill draft.
     * 3. Use the current plan's metrics as a validation baseline candidate when
     *    there's no prior baseline — avoid running the same plan a second time
     *    just to seed a baseline. A future A/B run can still refine it.
     * 4. Archive drafts that fail validation or come from failed plans.
     */
    async onPlanCompleted(plan: Plan): Promise<{
        reflection: Reflection;
        draft?: SkillDraft;
        validationOutcome?: "improved" | "baseline" | "pending" | "failed";
    }> {
        const reflection = await this.deps.learner.reflect(
            plan.sessionId,
            plan.goal,
            this.planOutcome(plan),
        );

        // Plans that didn't complete shouldn't seed new drafts — archive any
        // existing suggestion so it doesn't accumulate as noise.
        if (plan.status !== "completed") {
            if (reflection.suggestedSkill) {
                this.deps.skills.writeDraft(reflection.suggestedSkill);
                this.deps.skills.archiveDraft(reflection.suggestedSkill.name);
            }
            return { reflection };
        }

        let draft: SkillDraft | undefined;
        let validationOutcome: "improved" | "baseline" | "pending" | "failed" | undefined;

        if (
            reflection.suggestedSkill &&
            reflection.procedureConfidence >= MIN_PROCEDURE_CONFIDENCE
        ) {
            draft = this.deps.skills.writeDraft(reflection.suggestedSkill);
            logger.info("evolution.draft_created", {
                draftName: draft.name,
                sessionId: plan.sessionId,
                procedureConfidence: reflection.procedureConfidence,
            });
            validationOutcome = await this.recordBaselineCandidate(draft, plan);
        }

        this.persistReusableProcedure(plan, reflection, draft, validationOutcome);

        logger.info("evolution.plan_reflected", {
            sessionId: plan.sessionId,
            planId: plan.id,
            planStatus: plan.status,
            outcome: reflection.outcome,
            procedureConfidence: reflection.procedureConfidence,
            procedureUsable: !!(reflection.reusableProcedure && reflection.reusableProcedure.length >= MIN_PROCEDURE_LENGTH && reflection.procedureConfidence >= MIN_PROCEDURE_CONFIDENCE),
            validationOutcome: validationOutcome ?? "candidate",
        });

        return { reflection, draft, validationOutcome };
    }

    /**
     * Record the just-completed plan as a candidate baseline for a draft skill.
     * Returns the outcome that the engine will surface to the caller:
     *  - "baseline"  — first ever baseline, recorded.
     *  - "improved"  — current metrics beat the stored baseline.
     *  - "failed"    — current run was worse than the stored baseline; draft archived.
     */
    private async recordBaselineCandidate(
        draft: SkillDraft,
        plan: Plan,
    ): Promise<"improved" | "baseline" | "failed"> {
        const metrics: ValidationMetrics = {
            stepCount: plan.steps.length,
            failures: plan.steps.filter((s) => s.status === "failed" || s.status === "skipped").length,
            durationMs: Math.max(1, plan.updatedAt - plan.createdAt),
            status: plan.status === "completed" ? "completed" : "failed",
            recordedAt: Date.now(),
        };

        const planStore = this.deps.planStore;
        const baseline = planStore.getValidationBaseline(draft.name);

        if (!baseline) {
            planStore.recordValidationBaseline(draft.name, metrics);
            planStore.recordValidationAttempt(
                draft.name,
                "baseline",
                metrics,
                "baseline recorded from completed plan (no prior baseline)",
                plan.sessionId,
            );
            logger.info("evolution.baseline_recorded", {
                draftName: draft.name,
                sessionId: plan.sessionId,
                stepCount: metrics.stepCount,
                failures: metrics.failures,
            });
            return "baseline";
        }

        const improved = this.metricsBeat(metrics, baseline);
        if (improved) {
            planStore.recordValidationBaseline(draft.name, metrics);
            planStore.recordValidationAttempt(
                draft.name,
                "improved",
                metrics,
                `improved over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
                plan.sessionId,
            );
            this.deps.skills.promoteDraft(draft.name);
            logger.info("evolution.skill_promoted", {
                draftName: draft.name,
                sessionId: plan.sessionId,
                stepCount: metrics.stepCount,
                failures: metrics.failures,
                baselineFailures: baseline.failures,
            });
            return "improved";
        }

        planStore.recordValidationAttempt(
            draft.name,
            "failed",
            metrics,
            `no improvement over baseline: ${metrics.failures} failures/${metrics.stepCount} steps vs ${baseline.failures}/${baseline.stepCount}`,
            plan.sessionId,
        );
        this.deps.skills.archiveDraft(draft.name);
        logger.info("evolution.skill_archived", {
            draftName: draft.name,
            sessionId: plan.sessionId,
            stepCount: metrics.stepCount,
            failures: metrics.failures,
            baselineFailures: baseline.failures,
        });
        return "failed";
    }

    private metricsBeat(current: ValidationMetrics, baseline: ValidationMetrics): boolean {
        if (current.status === "completed" && baseline.status !== "completed") return true;
        if (current.status !== "completed" && baseline.status === "completed") return false;
        if (current.failures < baseline.failures) return true;
        if (current.failures === baseline.failures && current.stepCount <= baseline.stepCount) return true;
        return false;
    }

    private persistReusableProcedure(
        plan: Plan,
        reflection: Reflection,
        draft: SkillDraft | undefined,
        validationOutcome: "improved" | "baseline" | "pending" | "failed" | undefined,
    ): void {
        const procedure = reflection.reusableProcedure?.trim();
        const procedureUsable =
            !!procedure &&
            procedure.length >= MIN_PROCEDURE_LENGTH &&
            reflection.procedureConfidence >= MIN_PROCEDURE_CONFIDENCE;

        if (!procedureUsable && !draft) return;

        const lines = [
            `- Task: ${plan.goal}`,
            `- Session: ${plan.sessionId}`,
            `- Plan status: ${plan.status}`,
            `- Reflection outcome: ${reflection.outcome}`,
            `- Procedure confidence: ${reflection.procedureConfidence.toFixed(2)}`,
            `- Validation: ${validationOutcome ?? "candidate"}`,
        ];

        if (draft) {
            lines.push(`- Skill draft: ${draft.name} — ${draft.description}`);
        }

        if (procedureUsable && procedure) {
            lines.push("- Reusable procedure:");
            lines.push(this.indentBlock(procedure));
        }

        if (reflection.whatWorked.length > 0) {
            lines.push(`- What worked: ${reflection.whatWorked.join("; ")}`);
        }

        if (reflection.whatFailed.length > 0) {
            lines.push(`- What failed: ${reflection.whatFailed.join("; ")}`);
        }

        const action: MemoryAction = {
            kind: "append",
            section: PROCEDURE_SECTION,
            body: lines.join("\n"),
        };

        const result = this.deps.memoryStore.apply(action);
        if (!result.ok) return;

        try {
            this.deps.tape.append({
                kind: "memory_write",
                sessionId: plan.sessionId,
                action,
                reason: "persist reusable procedure from completed plan",
                diff: result.diff,
                autonomyDecision: "auto",
                ts: Date.now(),
            } as TapeEntry);
        } catch {
            // Tape should not make the evolution loop fail after memory is already updated.
        }
    }

    private indentBlock(text: string, prefix = "  "): string {
        return text
            .split("\n")
            .map((line) => `${prefix}${line}`)
            .join("\n");
    }

    private planOutcome(plan: Plan): Reflection["outcome"] {
        if (plan.status === "completed") return "success";
        if (plan.status === "failed") return "failure";
        return "partial";
    }
}