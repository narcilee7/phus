import { SubAgentAgentLike } from "@/core/runtime/subagent/types";
import { Verifier } from "@/core/runtime/verifier";
import type { Plan, PlanPhase, Step } from "@/core/runtime/plan/types";

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