import type { Plan } from "@/core/runtime/plan/types";
import type { MemoryAction } from "@/infra/memory/index.js";
import { SkillValidator } from "@/core/runtime/skill/validator";
import type { SkillDraft } from "@/infra/skills/draft";
import type { TapeEntry } from "@/types/tape/index.js";
import { EvolutionDeps, Reflection } from "./types";

const PROCEDURE_SECTION = "Procedures";

export class EvolutionEngine {
  readonly skillValidator: SkillValidator;

  constructor(private deps: EvolutionDeps) {
    this.skillValidator = deps.skillValidator;
  }

  /**
   * Called after a plan completes.
   * 1. Reflect on the completed plan.
   * 2. If a reusable procedure is found, write a skill draft.
   * 3. Queue validation for the draft.
   */
  async onPlanCompleted(plan: Plan): Promise<{ reflection: Reflection; draft?: SkillDraft; validated?: boolean }> {
    const reflection = await this.deps.learner.reflect(
      plan.sessionId,
      plan.goal,
      this.planOutcome(plan),
    );

    if (plan.status !== "completed") {
      return { reflection };
    }

    let draft: SkillDraft | undefined;
    let validated: boolean | undefined;

    if (reflection.suggestedSkill) {
      draft = this.deps.skills.writeDraft(reflection.suggestedSkill);

      // Phase 2 runs validation inline; a future scheduler could queue this.
      try {
        const result = await this.deps.skillValidator.validate(
          draft.name,
          plan.goal,
          plan.sessionId,
        );
        validated = result.improved;
      } catch (err) {
        validated = false;
      }
    }

    this.persistReusableProcedure(plan, reflection, draft, validated);

    return { reflection, draft, validated };
  }

  private persistReusableProcedure(
    plan: Plan,
    reflection: Reflection,
    draft: SkillDraft | undefined,
    validated: boolean | undefined,
  ): void {
    const procedure = reflection.reusableProcedure?.trim();
    if (!procedure && !draft) return;

    const lines = [
      `- Task: ${plan.goal}`,
      `- Session: ${plan.sessionId}`,
      `- Plan status: ${plan.status}`,
      `- Reflection outcome: ${reflection.outcome}`,
      `- Validation: ${validated === true ? "validated" : "candidate"}`,
    ];

    if (draft) {
      lines.push(`- Skill draft: ${draft.name} — ${draft.description}`);
    }

    if (procedure) {
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
