// test/channels/slack.test.ts
import { describe, expect, it, vi } from "vitest";
import { SlackChannel } from "../../src/channels/slack.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

describe("SlackChannel", () => {
  it("status reports not listening before launch", () => {
    const ch = new SlackChannel({ botToken: "xoxb-dummy", appToken: "xapp-dummy" });
    expect(ch.status()).toEqual({
      name: "slack",
      listening: false,
      connected: 0,
      details: { allowedUsers: 0 },
    });
  });

  it("throws when tokens are missing", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    const ch = new SlackChannel();
    await expect(ch.listen({} as PhusAgent)).rejects.toThrow("SLACK_BOT_TOKEN and SLACK_APP_TOKEN");
  });

  it("send routes text outbounds through chat.postMessage", async () => {
    const postMessage = vi.fn().mockResolvedValue({});
    const ch = new SlackChannel({ botToken: "xoxb-dummy", appToken: "xapp-dummy" });
    (ch as any).app = {
      client: { chat: { postMessage } },
      start: vi.fn(),
      stop: vi.fn(),
    };

    await ch.send([
      { type: "text", content: "hello", to: "C123", channel: "slack", metadata: { threadTs: "123.45" } },
      { type: "image", content: "", to: "C123", channel: "slack" },
    ]);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "hello",
      thread_ts: "123.45",
    });
  });

  it("send swallows postMessage errors", async () => {
    const postMessage = vi.fn().mockRejectedValue(new Error("network"));
    const ch = new SlackChannel({ botToken: "xoxb-dummy", appToken: "xapp-dummy" });
    (ch as any).app = {
      client: { chat: { postMessage } },
      start: vi.fn(),
      stop: vi.fn(),
    };

    await expect(
      ch.send([{ type: "text", content: "x", to: "C1", channel: "slack" }]),
    ).resolves.toBeUndefined();
  });

  it("isAllowed accepts everyone when no allow-list is configured", () => {
    const ch = new SlackChannel({ botToken: "xoxb-dummy", appToken: "xapp-dummy" });
    expect((ch as any).isAllowed("U123")).toBe(true);
  });

  it("isAllowed respects allowedUsers", () => {
    const ch = new SlackChannel({ botToken: "xoxb-dummy", appToken: "xapp-dummy", allowedUsers: ["U42"] });
    expect((ch as any).isAllowed("U42")).toBe(true);
    expect((ch as any).isAllowed("U7")).toBe(false);
  });
});
