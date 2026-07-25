"use client";

import type { AgentMessageChunk, ControlResponse, PhusTransport } from "./phus-transport";

export interface WebSocketTransportConfig {
  url: string;
  clientId?: string;
}

type PendingMessage =
  | { kind: "text"; content: string }
  | { kind: "control"; payload: string };

/**
 * Browser transport that talks to a Phus WebSocketChannel (usually served by
 * `phus gateway`).
 */
export class WebSocketTransport implements PhusTransport {
  readonly name = "websocket";
  private socket: WebSocket | null = null;
  private readonly messageHandlers = new Set<(chunk: AgentMessageChunk) => void>();
  private readonly statusHandlers = new Set<(status: AgentMessageChunk["status"]) => void>();
  private readonly controlHandlers = new Set<(response: ControlResponse<unknown>) => void>();
  private readonly clientId: string;
  private pending: PendingMessage[] = [];
  private closed = false;
  private controlPending = new Map<string, (response: ControlResponse<unknown>) => void>();

  constructor(private readonly config: WebSocketTransportConfig) {
    this.clientId = config.clientId ?? crypto.randomUUID();
    this.connect();
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === "undefined") return;

    const socket = new WebSocket(this.config.url);
    this.socket = socket;

    socket.onopen = () => {
      this.emitStatus("connected");
      for (const item of this.pending) {
        if (item.kind === "text") {
          this.sendRaw(item.content);
        } else {
          socket.send(item.payload);
        }
      }
      this.pending = [];
    };

    socket.onmessage = (event) => {
      let chunk: AgentMessageChunk;
      try {
        chunk = JSON.parse(String(event.data)) as AgentMessageChunk;
      } catch {
        chunk = { type: "text", content: String(event.data) };
      }
      if (chunk.type === "control_response") {
        const response: ControlResponse<unknown> = {
          action: chunk.action ?? "unknown",
          data: chunk.data,
          error: chunk.error,
        };
        for (const handler of this.controlHandlers) {
          handler(response);
        }
        const pending = this.controlPending.get(response.action);
        if (pending) {
          this.controlPending.delete(response.action);
          pending(response);
        }
      }
      for (const handler of this.messageHandlers) {
        handler(chunk);
      }
    };

    socket.onerror = () => {
      this.emitStatus("disconnected");
    };

    socket.onclose = () => {
      this.socket = null;
      this.emitStatus("disconnected");
      if (!this.closed) {
        window.setTimeout(() => this.connect(), 2000);
      }
    };
  }

  async send(content: string): Promise<void> {
    if (this.closed) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendRaw(content);
    } else {
      this.pending.push({ kind: "text", content });
    }
  }

  async sendControl<T = unknown>(action: string, sessionId?: string): Promise<ControlResponse<T>> {
    return new Promise((resolve) => {
      const payload = JSON.stringify({ type: "control", action, sessionId, clientId: this.clientId });
      const timer = window.setTimeout(() => {
        this.controlPending.delete(action);
        resolve({ action, error: "timeout" } as ControlResponse<T>);
      }, 5000);
      this.controlPending.set(action, (response) => {
        window.clearTimeout(timer);
        resolve(response as ControlResponse<T>);
      });
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(payload);
      } else {
        this.pending.push({ kind: "control", payload });
      }
    });
  }

  private sendRaw(content: string): void {
    this.socket?.send(JSON.stringify({ type: "text", content, clientId: this.clientId }));
  }

  abort(): void {
    this.socket?.send(JSON.stringify({ type: "abort" }));
  }

  onMessage(handler: (chunk: AgentMessageChunk) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStatus(handler: (status: AgentMessageChunk["status"]) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onControlResponse(handler: (response: ControlResponse<unknown>) => void): () => void {
    this.controlHandlers.add(handler);
    return () => {
      this.controlHandlers.delete(handler);
    };
  }

  async getModelLabel(): Promise<string> {
    try {
      const response = await this.sendControl<string>("get_model_label");
      if (typeof response.data === "string") return response.data;
    } catch {
      // fall back to default label
    }
    return "websocket/unknown";
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  private emitStatus(status: AgentMessageChunk["status"]): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}
