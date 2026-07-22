import { SessionId } from "@phus/core/types/brand.js";
import { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

export interface SubAgentAgentLike {
  steer(message: AgentMessage): void;
  waitForIdle(): Promise<void>;
  getCurrentSessionId(): SessionId | undefined;
  setNextSessionId(id: SessionId): void;
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
  /** Run a one-shot prompt on a specific session id and resolve
   *  with the final agent messages. The sub-agent uses this instead
   *  of `steer()` so the sub-task's tool calls + tool results don't
   *  leak into the parent's message history. The optional `signal`
   *  is plumbed into the underlying LLM call so a timeout or
   *  user abort kills the in-flight request immediately. */
  runTurn(
    sessionId: SessionId,
    taskText: string,
    signal?: AbortSignal,
  ): Promise<AgentMessage[]>;
  /** Abort the in-flight run (used by the sub-agent timeout). Optional
   *  so lighter test doubles still satisfy the interface. */
  abort?(): void;
}
