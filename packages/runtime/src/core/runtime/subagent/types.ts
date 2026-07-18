import { SessionId } from "@/types/brand";
import { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";

export interface SubAgentAgentLike {
  steer(message: AgentMessage): void;
  waitForIdle(): Promise<void>;
  getCurrentSessionId(): SessionId | undefined;
  setNextSessionId(id: SessionId): void;
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
}
