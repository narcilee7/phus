// test/channels/sse.test.ts
import { describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import { SSEChannel } from "../../src/channels/sse.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";
import type { Envelope } from "../../src/types/channel/index.js";

describe("SSEChannel", () => {
  it("listens on a port and reports status", async () => {
    const ch = new SSEChannel({ port: 0 });
    await ch.listen(makeMockAgent() as unknown as PhusAgent);

    const status = ch.status();
    expect(status.listening).toBe(true);
    expect(status.connected).toBe(0);
    expect(typeof status.details?.port).toBe("number");

    await ch.close();
    expect(ch.status().listening).toBe(false);
  });

  it("accepts SSE connections and POST messages", async () => {
    const ch = new SSEChannel({ port: 0 });
    const agent = makeMockAgent(async (envelope, channel) => {
      await channel.send([
        { type: "text", content: `reply: ${envelope.content}`, to: envelope.from, channel: "sse" },
      ]);
    });
    await ch.listen(agent as unknown as PhusAgent);

    const port = ch.status().details.port as number;
    const sseMessages: string[] = [];
    const clientId = "test-client";

    // Start SSE stream
    const sseReq = http.get(`http://127.0.0.1:${port}/events?clientId=${clientId}`, (res) => {
      res.setEncoding("utf-8");
      res.on("data", (chunk) => sseMessages.push(chunk));
    });

    // Wait a tick for the server to register the connection
    await new Promise((r) => setTimeout(r, 50));

    // POST a message
    const postResult = await postJson(port, `/message?clientId=${clientId}`, { content: "hello" });
    expect(postResult.accepted).toBe(true);

    // Wait for SSE data
    await new Promise((r) => setTimeout(r, 100));

    const dataLines = sseMessages.join("").split("\n\n").filter(Boolean);
    expect(dataLines.some((line) => line.includes('"event":"connected"'))).toBe(true);
    expect(dataLines.some((line) => line.includes('"content":"reply: hello"'))).toBe(true);

    expect(agent.turn).toHaveBeenCalledWith(
      expect.objectContaining<Partial<Envelope>>({
        channel: "sse",
        from: clientId,
        content: "hello",
        metadata: { chatId: clientId },
      }),
      ch,
    );

    sseReq.destroy();
    await ch.close();
  });

  it("returns 404 for unknown endpoints", async () => {
    const ch = new SSEChannel({ port: 0 });
    await ch.listen(makeMockAgent() as unknown as PhusAgent);
    const port = ch.status().details.port as number;

    const status = await getStatus(port, "/unknown");
    expect(status).toBe(404);

    await ch.close();
  });
});

function makeMockAgent(turnImpl?: (envelope: Envelope, channel: any) => Promise<void>) {
  return {
    turn: vi.fn(async (envelope: Envelope, channel: any) => {
      if (turnImpl) await turnImpl(envelope, channel);
    }),
  };
}

function postJson(port: number, path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function getStatus(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject);
  });
}
