// src/core/llm/meta/index.ts
// Meta tools aggregator. `createMetaTools(skills, tape)` was the
// monolith entry point; this module keeps that signature stable while
// internally composing skill-tools + system-tools.

import type { MetaTool } from "@/types/tool.js";
import type { Tape } from "@/core/session/tape.js";
import { defineSkillMetaTools } from "./skill-tools.js";
import { defineSystemMetaTools } from "./system-tools.js";
import type { SkillRegistry } from "@/core/runtime/skills/skill.js";

export function createMetaTools(skills: SkillRegistry, tape: Tape): MetaTool[] {
  const skillTools = defineSkillMetaTools({
    write: (input) => skills.write(input),
    get: (name) => skills.get(name),
    delete: (name) => skills.delete(name),
  });

  const systemTools = defineSystemMetaTools({
    tape: {
      replay: (sessionId) => tape.replay(sessionId),
      stats: () => tape.stats(),
    },
    compactSession: async (tapeConcrete, sessionId, opts) => {
      const { compactSession } = await import("@/core/session/compaction.js");
      return compactSession(tapeConcrete as Tape, sessionId, opts);
    },
    tapeConcrete: tape,
  });

  return [...skillTools, ...systemTools];
}

export { defineSkillMetaTools } from "./skill-tools.js";
export { defineSystemMetaTools } from "./system-tools.js";