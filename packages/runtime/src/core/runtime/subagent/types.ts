import { SessionId } from "@/types/brand";
import { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

export interface SubAgentAgentLike {
  steer(message: AgentMessage): void;
  waitForIdle(): Promise<void>;
  getCurrentSessionId(): SessionId | undefined;
  setNextSessionId(id: SessionId): void;
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
  /** Abort the in-flight run (used by the sub-agent timeout). Optional
   *  so lighter test doubles still satisfy the interface. */
  abort?(): void;
}
