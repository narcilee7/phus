import { Type } from "@mariozechner/pi-ai";
import type { MetaTool } from "@phus/runtime/types/tool.js";
import { asSessionId } from "@phus/core/types/brand.js";
import { Learner } from "@phus/core/runtime/evolution/learner.js";
import { EvolutionEngine } from "@phus/core/runtime/evolution/engine.js";
import type { SkillRegistry } from "../skills/registry.js";

export function defineEvolutionMetaTools(deps: {
  learner: Learner;
  evolutionEngine: EvolutionEngine;
  skills: SkillRegistry;
}): MetaTool[] {
  return [
    {
      name: "reflect",
      description:
        "Reflect on a completed or failed session. Extracts what worked, what failed, " +
        "and any reusable procedure that could become a skill.",
      parameters: Type.Object({
        sessionId: Type.String({ description: "Session id to reflect on." }),
        task: Type.String({ description: "Description of the task that was attempted." }),
      }),
      execute: async (args) => {
        const sessionId = asSessionId(String(args.sessionId));
        const task = String(args.task);
        const reflection = await deps.learner.reflect(sessionId, task);
        return { ok: true, reflection };
      },
    },
    {
      name: "skill_validate",
      description:
        "Validate a skill draft by running the task with the draft temporarily promoted " +
        "and comparing the result to the stored baseline.",
      parameters: Type.Object({
        draftName: Type.String({ description: "Name of the draft skill to validate." }),
        task: Type.String({ description: "Task to use for validation." }),
        sessionId: Type.String({ description: "Session id under which to run the validation plan." }),
      }),
      execute: async (args) => {
        const draftName = String(args.draftName);
        const task = String(args.task);
        const sessionId = asSessionId(String(args.sessionId));
        const draft = deps.skills.getDraft(draftName);
        if (!draft) return { ok: false, error: "draft_not_found" };
        const result = await deps.evolutionEngine.skillValidator.validate(draftName, task, sessionId);
        return { ok: true, ...result };
      },
    },
  ];
}
