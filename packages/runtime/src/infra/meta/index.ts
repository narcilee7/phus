// src/core/llm/meta/index.ts
// Meta tools aggregator. `createMetaTools(skills, tape, memory)` was the
// monolith entry point; this module keeps that signature stable while
// internally composing skill-tools + system-tools + memory-tools + plan-tools + evolution-tools.

import type { MetaTool } from "@phus/runtime/types/tool.js";
import type { Tape } from "@phus/core/session/tape.js";
import { defineSkillMetaTools } from "./skill-tools.js";
import { defineSystemMetaTools } from "./system-tools.js";
import { defineMemoryMetaTools } from "./memory-tools.js";
import { definePlanMetaTools } from "./plan-tools.js";
import { defineEvolutionMetaTools } from "./evolution-tools.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { MemoryStore } from "../memory/index.js";
import type { SessionId } from "@phus/core/types/brand.js";
import type { PlanRunner } from "@phus/runtime/core/runtime/plan/plan-runner.js";
import type { PlanStore } from "@phus/core/session/plan-store.js";
import type { Learner } from "@phus/runtime/core/runtime/evolution/learner.js";
import type { EvolutionEngine } from "@phus/runtime/core/runtime/evolution/engine.js";

export function createMetaTools(
  skills: SkillRegistry,
  tape: Tape,
  memory: { store: MemoryStore; getCurrentSessionId?: () => SessionId | undefined },
  plan?: { runner: PlanRunner; store: PlanStore; getCurrentSessionId: () => SessionId | undefined },
  evolution?: { learner: Learner; evolutionEngine: EvolutionEngine },
): MetaTool[] {
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
      const { compactSession } = await import("@phus/core/session/compaction.js");
      return compactSession(tapeConcrete as Tape, sessionId, opts);
    },
    tapeConcrete: tape,
  });

  const memoryTools = defineMemoryMetaTools({
    store: memory.store,
    tape,
    getCurrentSessionId: memory.getCurrentSessionId,
  });

  const planTools = plan
    ? definePlanMetaTools({
        planRunner: plan.runner,
        planStore: plan.store,
        getCurrentSessionId: plan.getCurrentSessionId,
      })
    : [];

  const evolutionTools = evolution
    ? defineEvolutionMetaTools({
        learner: evolution.learner,
        evolutionEngine: evolution.evolutionEngine,
        skills,
      })
    : [];

  return [...skillTools, ...systemTools, ...memoryTools, ...planTools, ...evolutionTools];
}

export { defineSkillMetaTools } from "./skill-tools.js";
export { defineSystemMetaTools } from "./system-tools.js";
export { defineMemoryMetaTools } from "./memory-tools.js";
export { definePlanMetaTools } from "./plan-tools.js";
export { defineEvolutionMetaTools } from "./evolution-tools.js";
export { parseMemoryAction } from "./memory-tools.js";
