// src/channels/websocket.ts
// WebSocket channel — one connection per client, routed by clientId.

import { WebSocketServer, type WebSocket } from "ws";
import type { ChannelAdapter, ChannelStatus } from "./base.js";
import { makeEnvelopeFromChat } from "./base.js";
import type { Outbound } from "@phus/core/types/channel/index.js";
import type { SessionAddress } from "@phus/core/types/session/index.js";
import type { PhusAgent } from "../bridge/pi-agent.js";
import { logger } from "../infra/logging.js";

export interface WebSocketChannelConfig {
  port: number;
  host?: string;
  path?: string;
}

export class WebSocketChannel implements ChannelAdapter {
  readonly name = "websocket";
  private wss?: WebSocketServer;
  private sockets = new Map<string, WebSocket>();
  private agent?: PhusAgent;
  private closed = false;

  constructor(private readonly config: WebSocketChannelConfig) {}

  async listen(agent: PhusAgent): Promise<void> {
    if (this.closed) {
      throw new Error("WebSocketChannel has already been closed");
    }
    this.agent = agent;

    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
        path: this.config.path,
      });
      this.wss = wss;

      wss.on("error", (err: Error) => {
        logger.error("channel.websocket.error", { error: err.message });
        reject(err);
      });

      wss.on("connection", (socket: WebSocket, _req) => {
        const clientId = crypto.randomUUID();
        this.sockets.set(clientId, socket);
        logger.info("channel.websocket.connected", { clientId, count: this.sockets.size });

        socket.on("message", (raw: WebSocket.RawData) => {
          void this.handleMessage(socket, clientId, raw);
        });

        socket.on("close", () => {
          this.sockets.delete(clientId);
          logger.info("channel.websocket.disconnected", { clientId, count: this.sockets.size });
        });

        socket.on("error", (err: Error) => {
          logger.error("channel.websocket.socket_error", { clientId, error: err.message });
        });

        // Let the client know its id so it can route outbound replies.
        this.sendToSocket(socket, { type: "system", event: "connected", clientId });
      });

      wss.on("listening", () => {
        const address = wss.address();
        logger.info("channel.websocket.listening", { address });
        resolve();
      });
    });
  }

  private async handleMessage(socket: WebSocket, clientId: string, raw: Buffer | ArrayBuffer | Buffer[]): Promise<void> {
    const text = Array.isArray(raw)
      ? raw.map((b) => b.toString("utf-8")).join("")
      : raw.toString("utf-8");

    if (!text.trim()) return;

    const envelope = makeEnvelopeFromChat({
      channel: this.name,
      chatId: clientId,
      from: clientId,
      content: text,
      address: this.buildAddress(clientId, this.readThread(socket)),
    });

    try {
      await this.agent?.turn(envelope, this);
    } catch (err: any) {
      logger.error("channel.websocket.turn_failed", { clientId, error: err?.message ?? err });
      this.sendToSocket(socket, { type: "error", message: err?.message ?? String(err) });
    }
  }

  async send(outbounds: Outbound[]): Promise<void> {
    for (const msg of outbounds) {
      if (msg.type !== "text") continue;
      const socket = this.sockets.get(msg.to);
      if (!socket) {
        logger.warn("channel.websocket.client_not_found", { to: msg.to });
        continue;
      }
      this.sendToSocket(socket, {
        type: "text",
        content: msg.content,
        replyTo: msg.replyTo,
      });
    }
  }

  private sendToSocket(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === 1 /* OPEN */) {
      socket.send(JSON.stringify(payload));
    }
  }

  private readThread(socket: WebSocket): string | undefined {
    const protocol = (socket as { protocol?: string }).protocol;
    if (typeof protocol !== "string" || !protocol.includes("thread=")) return undefined;
    for (const part of protocol.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("thread=")) return trimmed.slice("thread=".length);
    }
    return undefined;
  }

  private buildAddress(clientId: string, thread?: string): SessionAddress {
    return {
      channel: "websocket",
      scope: `host:${this.config.host ?? "0.0.0.0"}:${this.config.port}`,
      conversationKey: `client:${clientId}`,
      threadKey: thread ? `thread:${thread}` : undefined,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [clientId, socket] of this.sockets) {
      try {
        socket.terminate();
      } catch (err: any) {
        logger.warn("channel.websocket.close_error", { clientId, error: err?.message ?? err });
      }
    }
    this.sockets.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
      this.wss = undefined;
    }
  }

  status(): ChannelStatus {
    const address = this.wss?.address();
    return {
      name: this.name,
      listening: this.wss !== undefined && !this.closed,
      connected: this.sockets.size,
      details: {
        port: typeof address === "object" ? address?.port : undefined,
        host: this.config.host,
        path: this.config.path,
      },
    };
  }
}
