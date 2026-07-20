// packages/runtime/src/core/runtime/plan/types.ts
// Plan data shapes + dep interfaces. CorePort is the injection port
// that Planner / Verifier / PlanRunner use to reach an LLM without
// importing @mariozechner/pi-agent-core.

import { SkillRegistryLike } from "@phus/core/types/index.js";
import type { SessionId } from "@phus/core/types/brand.js";
import type { CorePort } from "@/bridge/core-port.js";
import { HookRegistry } from "@/core/runtime/hook/registry";
import { Planner } from "./planner";
import { Executor } from "../executor";
import { PlanStore } from "@/core/session/plan-store";
import { EvolutionEngine } from "../evolution/engine";

export type PlanStatus = "pending" | "running" | "paused" | "completed" | "failed";

export type StepStatus =
	| "pending"
	| "running"
	| "blocked"
	| "completed"
	| "failed"
	| "skipped";

export type VerificationStatus =
	| "proceed"
	| "retry"
	| "replan"
	| "escalate"
	| "abort";

export type PlanPhase = "inspect" | "edit" | "test" | "repair";

export interface Step {
	id: string;
	index: number;
	description: string;
	expectedOutput?: string;
	status: StepStatus;
	retryCount: number;
	tool?: string;
	result?: unknown;
	dependsOn?: string[];
	/** Phase of code work: inspect / edit / test / repair. */
	phase?: PlanPhase;
	/** Failure context preserved for repair retries and resume. */
	repairContext?: string;
	/** Subagent session id responsible for this step, if delegated. */
	subagentSessionId?: SessionId;
	/** Short label for the subagent (e.g. "explore", "verify"). */
	subagentLabel?: string;
	/** Latest error message if the step failed. */
	error?: string;
	/** Intermediate output captured during execution. */
	output?: string;
}

export interface Plan {
	id: string;
	sessionId: SessionId;
	goal: string;
	status: PlanStatus;
	steps: Step[];
	createdAt: number;
	updatedAt: number;
}

export interface VerificationResult {
	ok: boolean;
	confidence: number;
	reason: string;
	action: VerificationStatus;
}

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
