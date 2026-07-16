// test/channels/websocket.test.ts
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { WebSocketChannel } from "../../src/channels/websocket.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";
import type { Envelope } from "../../src/types/channel/index.js";

describe("WebSocketChannel", () => {
  it("listens on a port and reports status", async () => {
    const ch = new WebSocketChannel({ port: 0 });
    const agent = makeMockAgent();
    await ch.listen(agent as unknown as PhusAgent);

    const status = ch.status();
    expect(status.listening).toBe(true);
    expect(status.connected).toBe(0);
    expect(typeof status.details?.port).toBe("number");

    await ch.close();
    expect(ch.status().listening).toBe(false);
  });

  it("forwards inbound text to agent.turn and replies to the client", async () => {
    const ch = new WebSocketChannel({ port: 0 });
    const agent = makeMockAgent(async (envelope, channel) => {
      await channel.send([
        { type: "text", content: `echo: ${envelope.content}`, to: envelope.from, channel: "websocket" },
      ]);
    });
    await ch.listen(agent as unknown as PhusAgent);

    const port = ch.status().details.port as number;
    const client = new WebSocket(`ws://127.0.0.1:${port}`);

    const connected = await waitForMessage(client);
    expect(JSON.parse(connected).event).toBe("connected");
    const clientId = JSON.parse(connected).clientId as string;

    client.send("hello");
    const reply = await waitForMessage(client);
    expect(JSON.parse(reply)).toEqual({
      type: "text",
      content: "echo: hello",
      replyTo: undefined,
    });

    expect(agent.turn).toHaveBeenCalledWith(
      expect.objectContaining<Partial<Envelope>>({
        channel: "websocket",
        from: clientId,
        content: "hello",
        metadata: { chatId: clientId },
      }),
      ch,
    );

    client.close();
    await ch.close();
  });

  it("warns and skips outbound for unknown client", async () => {
    const ch = new WebSocketChannel({ port: 0 });
    const agent = makeMockAgent();
    await ch.listen(agent as unknown as PhusAgent);

    await ch.send([{ type: "text", content: "lost", to: "no-such-client", channel: "websocket" }]);

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

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 2000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString("utf-8"));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
