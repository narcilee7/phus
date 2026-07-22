// packages/runtime/src/core/runtime/plan/types.ts
// Plan data shapes + dep interfaces. CorePort is the injection port
// that Planner / Verifier / PlanRunner use to reach an LLM without
// importing @mariozechner/pi-agent-core.
//
// Plan / Step / PlanPhase / PlanStatus / StepStatus are owned by
// `@phus/core/session/plan-store.js` (the canonical home — plan-store
// stores these). Re-exported here for downstream runtime consumers'
// convenience so existing `from "@phus/runtime/core/runtime/plan/types.js"`
// imports continue to work without touching every call site.

import { SkillRegistryLike } from "@phus/core/types/index.js";
import type { SessionId } from "@phus/core/types/brand.js";
import type { CorePort } from "../../../bridge/core-port.js";
import { HookRegistry } from "@phus/core/runtime/hook/registry.js";
import { Planner } from "./planner";
import { Executor } from "../executor";
import { PlanStore } from "@phus/core/session/plan-store.js";
import { EvolutionEngine } from "../evolution/engine";

// Re-export Plan-related types from core (canonical home).
// `export type { ... }` syntax doesn't bind type names in some tsc
// resolutions; use named re-exports so `PlanPhase`, `PlanStep`, etc.
// are visible to downstream importers.
import type {
	PlanStatus as _PlanStatus,
	PlanPhase as _PlanPhase,
	StepStatus as _StepStatus,
	PlanStep as _PlanStep,
	Plan as _Plan,
} from "@phus/core/session/plan-store.js";

export type PlanStatus = _PlanStatus;
export type PlanPhase = _PlanPhase;
export type StepStatus = _StepStatus;
export type PlanStep = _PlanStep;
export type Plan = _Plan;

// Local `Step` alias — kept for backward-compat with code that already
// imports `Step` from this path.
export type Step = PlanStep;

export interface VerificationResult {
	ok: boolean;
	confidence: number;
	reason: string;
	action: VerificationStatus;
}

export type VerificationStatus =
	| "proceed"
	| "retry"
	| "replan"
	| "escalate"
	| "abort";

// Todo: migrate to subagent dir
export interface SubAgentOptions {
	task: string;
	parentSessionId: string;
	context?: string;
	phase?: PlanPhase;
	repairContext?: string;
	maxSteps?: number;
}

/** Planner / Verifier / Learner all reach the LLM through CorePort. */
export type PlannerDeps = {
	skills: SkillRegistryLike;
	port: CorePort;
	hooks?: HookRegistry;
};

export type PlanRunnerDeps = {
	planner: Planner;
	executor: Executor;
	store: PlanStore;
	hooks: HookRegistry;
	evolutionEngine?: EvolutionEngine;
};