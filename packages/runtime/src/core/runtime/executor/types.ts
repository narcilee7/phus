import { SubAgentAgentLike } from "../subagent/types.js";
import { Verifier } from "@phus/runtime/core/runtime/verifier/index.js";
import type { Plan, PlanPhase, Step } from "../plan/types.js";

export interface ExecutorDeps {
    agent: SubAgentAgentLike;
    tools?: Map<string, (args: ToolArgs) => Promise<unknown>>;
    verifier: Verifier;
    maxRetries?: number;
}

export interface ToolArgs {
    description: string;
    expectedOutput?: string;
    phase?: PlanPhase;
    repairContext?: string;
}

// Re-exported for convenience in tests / wiring.
export type { Plan, Step };