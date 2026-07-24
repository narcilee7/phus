"use client";

import type { AgentMessageChunk, PhusTransport } from "./phus-transport";

export interface WebSocketTransportConfig {
  url: string;
  clientId?: string;
}

/**
 * Browser transport that talks to a Phus WebSocketChannel (usually served by
 * `phus gateway`).
 */
export class WebSocketTransport implements PhusTransport {
  readonly name = "websocket";
  private socket: WebSocket | null = null;
  private readonly messageHandlers = new Set<(chunk: AgentMessageChunk) => void>();
  private readonly statusHandlers = new Set<(status: AgentMessageChunk["status"]) => void>();
  private readonly clientId: string;
  private pending: string[] = [];
  private closed = false;

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
      for (const content of this.pending) {
        this.sendRaw(content);
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
      this.pending.push(content);
    }
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

  async getModelLabel(): Promise<string> {
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
