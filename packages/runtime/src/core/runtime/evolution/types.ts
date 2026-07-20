// packages/runtime/src/core/runtime/evolution/types.ts
// Reflection + Learner/Engine dep shapes. Uses the injected `CorePort`
// instead of importing @mariozechner/pi-agent-core.

import { SkillDraft } from "@/infra/skills/draft";
import { SkillRegistryLike, TapeLike } from "@/types";
import { SessionId } from "@/types/brand";
import type { CorePort } from "@/bridge/core-port.js";
import { SkillValidator } from "@/core/runtime/skill/validator";
import { SkillRegistry } from "@/infra/skills/registry";
import { PlanStore } from "@/core/session/plan-store";
import type { MemoryStore } from "@/infra/memory/index.js";
import { Learner } from "./learner";

export type ReflectionOutcomeStatus = "success" | "partial" | "failure";

export type Reflection = {
	sessionId: SessionId;
	task: string;
	outcome: ReflectionOutcomeStatus;
	whatWorked: string[];
	whatFailed: string[];
	/** Reusable step-by-step procedure: preconditions, success checks, failure modes. */
	reusableProcedure?: string;
	/** 0..1 self-rated confidence in the procedure; 0 when none. */
	procedureConfidence: number;
	suggestedSkill?: SkillDraft;
};

export type LearnerDeps = {
	tape: TapeLike;
	skills: SkillRegistryLike;
	port: CorePort;
};

export type EvolutionDeps = {
	learner: Learner;
	skillValidator: SkillValidator;
	skills: SkillRegistry;
	memoryStore: MemoryStore;
	tape: TapeLike;
	planStore: PlanStore;
};
