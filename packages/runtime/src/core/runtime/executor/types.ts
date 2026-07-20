import { SubAgentAgentLike } from "@phus/core/runtime/subagent/types.js";
import { Verifier } from "@phus/core/runtime/verifier.js";
import type { Plan, PlanPhase, Step } from "@phus/core/runtime/plan/types.js";

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