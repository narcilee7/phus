import type { Plan } from "@/core/runtime/plan/types.js";
import { Learner, type Reflection } from "@/core/runtime/learner.js";
import { SkillValidator } from "@/core/runtime/skill-validator.js";
import { SkillRegistry } from "@/infra/skills/registry.js";
import type { SkillDraft } from "@/infra/skills/draft.js";
import type { TapeLike } from "@/types/hooks/index.js";

export interface EvolutionDeps {
  learner: Learner;
  skillValidator: SkillValidator;
  skills: SkillRegistry;
  tape: TapeLike;
}

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

    return { reflection, draft, validated };
  }

  private planOutcome(plan: Plan): Reflection["outcome"] {
    if (plan.status === "completed") return "success";
    if (plan.status === "failed") return "failure";
    return "partial";
  }
}
