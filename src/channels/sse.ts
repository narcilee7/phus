// src/channels/sse.ts
// Server-Sent Events channel — outbound stream plus HTTP inbound endpoint.

import * as http from "node:http";
import { URL } from "node:url";
import type { ChannelAdapter, ChannelStatus } from "@/channels/base.js";
import { makeEnvelopeFromChat } from "@/channels/base.js";
import type { Outbound } from "@/types/channel/index.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/infra/logging.js";

export interface SSEChannelConfig {
  port: number;
  host?: string;
  /** Base path for both /events and /message endpoints. */
  path?: string;
}

export class SSEChannel implements ChannelAdapter {
  readonly name = "sse";
  private server?: http.Server;
  private responses = new Map<string, http.ServerResponse>();
  private agent?: PhusAgent;
  private closed = false;

  constructor(private readonly config: SSEChannelConfig) {}

  async listen(agent: PhusAgent): Promise<void> {
    if (this.closed) {
      throw new Error("SSEChannel has already been closed");
    }
    this.agent = agent;

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server = server;

      server.on("error", (err) => {
        logger.error("channel.sse.error", { error: err.message });
        reject(err);
      });

      server.listen(this.config.port, this.config.host, () => {
        logger.info("channel.sse.listening", { port: this.config.port, host: this.config.host });
        resolve();
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const base = this.config.path ?? "";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === `${base}/events`) {
      const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();

      // If a previous connection for this client id is still open, end it.
      const existing = this.responses.get(clientId);
      if (existing && !existing.writableEnded) {
        existing.end();
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "system", event: "connected", clientId })}\n\n`);

      this.responses.set(clientId, res);
      logger.info("channel.sse.connected", { clientId, count: this.responses.size });

      req.on("close", () => {
        if (this.responses.get(clientId) === res) {
          this.responses.delete(clientId);
        }
        logger.info("channel.sse.disconnected", { clientId, count: this.responses.size });
      });
      return;
    }

    if (req.method === "POST" && pathname === `${base}/message`) {
      void this.handlePost(url, req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  private async handlePost(
    url: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const clientId = url.searchParams.get("clientId") ?? "default";
    const body = await readBody(req);

    let content: string;
    try {
      const parsed = JSON.parse(body) as { content?: string };
      content = typeof parsed.content === "string" ? parsed.content : body;
    } catch {
      content = body;
    }

    if (!content.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "empty content" }));
      return;
    }

    const envelope = makeEnvelopeFromChat({
      channel: this.name,
      chatId: clientId,
      from: clientId,
      content,
    });

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, clientId }));

    try {
      await this.agent?.turn(envelope, this);
    } catch (err: any) {
      logger.error("channel.sse.turn_failed", { clientId, error: err?.message ?? err });
      const response = this.responses.get(clientId);
      if (response && !response.writableEnded) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? String(err) })}\n\n`);
      }
    }
  }

  async send(outbounds: Outbound[]): Promise<void> {
    for (const msg of outbounds) {
      if (msg.type !== "text") continue;
      const res = this.responses.get(msg.to);
      if (!res || res.writableEnded) {
        logger.warn("channel.sse.client_not_found", { to: msg.to });
        continue;
      }
      const payload = JSON.stringify({
        type: "text",
        content: msg.content,
        replyTo: msg.replyTo,
      });
      res.write(`data: ${payload}\n\n`);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [clientId, res] of this.responses) {
      try {
        if (!res.writableEnded) res.end();
      } catch (err: any) {
        logger.warn("channel.sse.close_error", { clientId, error: err?.message ?? err });
      }
    }
    this.responses.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
    }
  }

  status(): ChannelStatus {
    const address = this.server?.address();
    return {
      name: this.name,
      listening: this.server !== undefined && !this.closed,
      connected: this.responses.size,
      details: {
        port: typeof address === "object" ? address?.port : this.config.port,
        host: this.config.host,
        path: this.config.path,
      },
    };
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}
