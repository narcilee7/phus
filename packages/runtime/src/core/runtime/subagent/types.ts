import { SessionId } from "@phus/core/types/brand.js";
import type { Agent, AgentTool } from "@mariozechner/pi-agent-core";

/** Tooling + model + system prompt the sub-agent needs to spin up
 *  its own isolated Agent. Shared by reference with the parent
 *  (tools, skills, model) so we don't rebuild them per call, but
 *  the sub-agent's *session* and *messages* are private. */
export interface SubAgentAgentLike {
  /** Build a fully-isolated Agent for the sub-agent's run. The
   *  returned Agent has its own private `state.messages` and its
   *  own session id — its tool calls + tool results never bleed
   *  into the parent's history. */
  spawnSubAgent(opts: {
    systemPrompt: string;
    tools: AgentTool[];
    sessionId: SessionId;
  }): Agent;
  /** Tool list to pass to the sub-agent. The sub-agent passes this
   *  to spawnSubAgent(); the parent owns the canonical list. */
  getTools(): AgentTool[];
  /** Skill prompt context (the `Available skills` block). */
  getSkillsPrompt(): string;
  /** Abort the in-flight parent-side generation. Sub-agent uses this
   *  for its timeout — aborts the parent generation signal which
   *  the sub-agent's signal plumbs to. */
  abort?(): void;
  /** Runtime-level abort signal. Composed with the per-run timeout
   *  signal in SubAgent.run so a Ctrl+C reaches the in-flight
   *  LLM call inside the sub-agent's Agent.prompt(). */
  getAbortSignal(): AbortSignal;
}
