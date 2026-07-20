// src/core/llm/meta/skill-tools.ts
// Meta tools for skill CRUD: skill_write, skill_read, skill_delete.

import { Type } from "@mariozechner/pi-ai";
import type { MetaTool } from "@phus/runtime/types/tool.js";

export function defineSkillMetaTools(skills: {
  write: (input: { name: string; description: string; body: string; metadata: Record<string, unknown> }) => { location: string };
  get: (name: string) => unknown;
  delete: (name: string) => boolean;
}): MetaTool[] {
  return [
    {
      name: "skill_write",
      description:
        "Create or update a skill. Body is a prompt guide the agent reads at runtime — not executable code. " +
        "The skill becomes immediately available in the system prompt.",
      parameters: Type.Object({
        name: Type.String({ description: "Skill name in kebab-case. Must match directory name." }),
        description: Type.String({ description: "One-line description shown in the system prompt." }),
        body: Type.String({ description: "Markdown body — instructions the agent reads when the skill is invoked." }),
        metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
      }),
      execute: async (args) => {
        const name = String(args.name);
        const description = String(args.description);
        const body = String(args.body);
        const metadata = (args.metadata as Record<string, unknown> | undefined) ?? {};
        const saved = skills.write({ name, description, body, metadata });
        return { ok: true, path: saved.location };
      },
    },
    {
      name: "skill_read",
      description: "Read an existing skill's full body and metadata.",
      parameters: Type.Object({
        name: Type.String(),
      }),
      execute: async (args) => {
        const skill = skills.get(String(args.name));
        if (!skill) return { ok: false, error: "skill_not_found" };
        return { ok: true, skill };
      },
    },
    {
      name: "skill_delete",
      description: "Remove a skill from disk permanently.",
      parameters: Type.Object({
        name: Type.String(),
      }),
      execute: async (args) => {
        const removed = skills.delete(String(args.name));
        return { ok: removed };
      },
    },
  ];
}