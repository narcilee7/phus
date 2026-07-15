// src/core/internal-commands/builtins/skills.ts
// ,skills / ,skill / ,skill-review* — skill and draft management.

import type { InternalCommand, InternalCommandServices } from "../types.js";

export function defineSkillCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "skills",
      description: "list discovered skills",
      handler: async () => {
        const list = services.agent.getAllSkills();
        if (list.length === 0) return "(no skills loaded)";
        return list
          .map((s) =>
            `  ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})  ${s.description}`,
          )
          .join("\n");
      },
    },
    {
      name: "skill",
      description: "print a skill's body",
      usage: "name=<skill-name>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,skill name=<name>";
        const skill = services.agent.getSkill(name);
        if (!skill) return `skill not found: ${name}`;
        return `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`;
      },
    },
    {
      name: "skill-review",
      description: "list skill drafts awaiting human approval (B.4.4)",
      handler: async () => {
        const { DraftsStore } = await import("@/core/session/drafts.js");
        const drafts = new DraftsStore();
        const list = await drafts.list();
        if (list.length === 0) return "(no drafts)";
        return list.map((d) => `  ${d.name.padEnd(28)} ${d.description}`).join("\n");
      },
    },
    {
      name: "skill-review.approve",
      description: "move a draft into active skills/",
      usage: "name=<draft-name>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,skill-review.approve name=<draft-name>";
        const { DraftsStore } = await import("@/core/session/drafts.js");
        const drafts = new DraftsStore();
        try {
          const path = await drafts.approve(name);
          return `✓ approved "${name}" → ${path}`;
        } catch (err: any) {
          return `approve failed: ${err.message}`;
        }
      },
    },
    {
      name: "skill-review.reject",
      description: "delete a draft",
      usage: "name=<draft-name>",
      handler: async ({ args }) => {
        const name = args.name;
        if (!name) return "usage: ,skill-review.reject name=<draft-name>";
        const { DraftsStore } = await import("@/core/session/drafts.js");
        const drafts = new DraftsStore();
        const ok = await drafts.reject(name);
        return ok ? `✗ rejected "${name}"` : `not found: ${name}`;
      },
    },
  ];
}