/**
 * PhusTransport — platform-agnostic client surface for talking to a Phus
 * runtime. The web implementation uses WebSocket/SSE; the desktop
 * implementation bridges through Electron IPC. The UI code consumes only
 * this interface.
 */

export interface AgentMessageChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "status";
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { id: string; output: unknown };
  status?: "connected" | "disconnected" | "idle" | "busy";
  error?: string;
}

export interface PhusTransport {
  /** Human-readable transport label for the status bar. */
  readonly name: string;

  /** Send a user message. */
  send(content: string): Promise<void>;

  /** Abort the current turn. */
  abort(): void;

  /** Register a message handler. Returns an unsubscribe function. */
  onMessage(handler: (chunk: AgentMessageChunk) => void): () => void;

  /** Register a connection-status handler. Returns an unsubscribe function. */
  onStatus(handler: (status: AgentMessageChunk["status"]) => void): () => void;

  /** Request the current model label (best-effort). */
  getModelLabel(): Promise<string>;

  /** Explicitly close the transport. */
  close?(): void;
}

export function createNoopTransport(): PhusTransport {
  return {
    name: "noop",
    async send() {},
    abort() {},
    onMessage() {
      return () => {};
    },
    onStatus() {
      return () => {};
    },
    async getModelLabel() {
      return "none";
    },
  };
}
