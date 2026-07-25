/**
 * PhusTransport — platform-agnostic client surface for talking to a Phus
 * runtime. The web implementation uses WebSocket/SSE; the desktop
 * implementation bridges through Electron IPC. The UI code consumes only
 * this interface.
 */

export interface AgentMessageChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "status" | "system" | "control_response";
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { id: string; output: unknown };
  status?: "connected" | "disconnected" | "idle" | "busy";
  error?: string;
  event?: string;
  clientId?: string;
  action?: string;
  data?: unknown;
}

export interface ControlResponse<T = unknown> {
  action: string;
  data?: T;
  error?: string;
}

export interface PhusTransport {
  /** Human-readable transport label for the status bar. */
  readonly name: string;

  /** Send a user message. */
  send(content: string): Promise<void>;

  /** Send a control request and await the matching response. */
  sendControl<T = unknown>(action: string, sessionId?: string): Promise<ControlResponse<T>>;

  /** Abort the current turn. */
  abort(): void;

  /** Register a message handler. Returns an unsubscribe function. */
  onMessage(handler: (chunk: AgentMessageChunk) => void): () => void;

  /** Register a connection-status handler. Returns an unsubscribe function. */
  onStatus(handler: (status: AgentMessageChunk["status"]) => void): () => void;

  /** Register a control-response handler. Returns an unsubscribe function. */
  onControlResponse?(handler: (response: ControlResponse<unknown>) => void): () => void;

  /** Request the current model label (best-effort). */
  getModelLabel(): Promise<string>;

  /** Explicitly close the transport. */
  close?(): void;
}

export function createNoopTransport(): PhusTransport {
  return {
    name: "noop",
    async send() {},
    async sendControl() {
      return { action: "noop", error: "not connected" };
    },
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
