// test/channels/telegram.test.ts
import { describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "../../src/channels/telegram.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

describe("TelegramChannel", () => {
  it("status reports not listening before launch", () => {
    const ch = new TelegramChannel({ token: "dummy" });
    expect(ch.status()).toEqual({
      name: "telegram",
      listening: false,
      connected: 0,
      details: { allowedUsers: 0, allowedChats: 0 },
    });
  });

  it("throws when token is missing", async () => {
    delete process.env.TELEGRAM_TOKEN;
    const ch = new TelegramChannel();
    await expect(ch.listen({} as PhusAgent)).rejects.toThrow("token not configured");
  });

  it("send routes text outbounds through bot.telegram.sendMessage", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const stop = vi.fn();
    const ch = new TelegramChannel({ token: "dummy" });

    // Inject a fake bot instance
    (ch as any).bot = {
      telegram: { sendMessage },
      on: vi.fn(),
      launch: vi.fn().mockResolvedValue(undefined),
      stop,
    };

    await ch.send([
      { type: "text", content: "hello", to: "123", channel: "telegram", replyTo: "456" },
      { type: "image", content: "", to: "123", channel: "telegram" },
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("123", "hello", {
      reply_parameters: { message_id: 456 },
    });

    await ch.close();
    expect(stop).toHaveBeenCalled();
  });

  it("send swallows sendMessage errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("network"));
    const ch = new TelegramChannel({ token: "dummy" });
    (ch as any).bot = {
      telegram: { sendMessage },
      on: vi.fn(),
      launch: vi.fn(),
      stop: vi.fn(),
    };

    await expect(
      ch.send([{ type: "text", content: "x", to: "1", channel: "telegram" }]),
    ).resolves.toBeUndefined();
  });

  it("isAllowed accepts everyone when no allow-list is configured", () => {
    const ch = new TelegramChannel({ token: "dummy" });
    expect((ch as any).isAllowed("any", "any")).toBe(true);
  });

  it("isAllowed respects allowedUsers", () => {
    const ch = new TelegramChannel({ token: "dummy", allowedUsers: ["42"] });
    expect((ch as any).isAllowed("42", "1")).toBe(true);
    expect((ch as any).isAllowed("7", "1")).toBe(false);
  });

  it("isAllowed respects allowedChats", () => {
    const ch = new TelegramChannel({ token: "dummy", allowedChats: ["99"] });
    expect((ch as any).isAllowed("7", "99")).toBe(true);
    expect((ch as any).isAllowed("7", "1")).toBe(false);
  });

  it("normalizes comma-separated env allow lists", () => {
    process.env.TELEGRAM_ALLOW_USERS = " 1 , 2 ,3 ";
    const ch = new TelegramChannel({ token: "dummy" });
    expect((ch as any).isAllowed("2", "any")).toBe(true);
    delete process.env.TELEGRAM_ALLOW_USERS;
  });
});
