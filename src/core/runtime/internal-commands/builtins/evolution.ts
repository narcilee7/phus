// src/core/runtime/internal-commands/builtins/evolution.ts
// Self-evolution commands: reflection, draft management, startup suggestions.

import type { InternalCommand, InternalCommandServices } from "../types.js";
import { asSessionId } from "@/types/brand.js";

export function defineEvolutionCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "reflect",
      description: "reflect on a session and extract a reusable skill draft",
      usage: "[sessionId] [task]",
      handler: async ({ positional }) => {
        const sessionId = positional[0];
        const task = positional.slice(1).join(" ").trim();
        if (!sessionId || !task) return "usage: ,reflect <sessionId> <task>";
        const reflection = await services.agent.reflect(asSessionId(sessionId), task);
        const lines = [
          `outcome: ${reflection.outcome}`,
          `what worked: ${reflection.whatWorked.join("; ") || "(nothing recorded)"}`,
          `what failed: ${reflection.whatFailed.join("; ") || "(nothing recorded)"}`,
        ];
        if (reflection.reusableProcedure) {
          lines.push(`reusable procedure: ${reflection.reusableProcedure.slice(0, 200)}`);
        }
        if (reflection.suggestedSkill) {
          lines.push(`suggested skill: ${reflection.suggestedSkill.name} — ${reflection.suggestedSkill.description}`);
        }
        return lines.join("\n");
      },
    },
    {
      name: "skill",
      description: "skill and draft management",
      usage: "name=<skill-name> | drafts | promote <name> | archive <name>",
      handler: async ({ args, positional }) => {
        // Backward-compatible: ,skill name=<skill-name> prints the skill body.
        if (args.name) {
          const skill = services.agent.getSkill(args.name);
          if (!skill) return `skill not found: ${args.name}`;
          return `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`;
        }

        const sub = positional[0];
        const name = positional[1];

        switch (sub) {
          case "drafts": {
            const drafts = services.agent.getSkillDrafts();
            if (drafts.length === 0) return "(no drafts)";
            return drafts
              .map((d) => `  ${d.name.padEnd(28)} ${d.description}`)
              .join("\n");
          }
          case "promote": {
            if (!name) return "usage: ,skill promote <name>";
            const ok = services.agent.promoteSkillDraft(name);
            return ok ? `promoted "${name}"` : `draft not found: ${name}`;
          }
          case "archive": {
            if (!name) return "usage: ,skill archive <name>";
            const ok = services.agent.archiveSkillDraft(name);
            return ok ? `archived "${name}"` : `draft not found: ${name}`;
          }
          default:
            return "usage: ,skill name=<name> | drafts | promote <name> | archive <name>";
        }
      },
    },
    {
      name: "startup",
      description: "startup.sh suggestions",
      usage: "suggest",
      handler: async ({ positional }) => {
        const sub = positional[0];
        if (sub !== "suggest") return "usage: ,startup suggest";
        return await services.agent.suggestStartup();
      },
    },
  ];
}
