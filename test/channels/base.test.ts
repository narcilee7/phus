// test/channels/base.test.ts
import { describe, expect, it } from "vitest";
import { makeEnvelopeFromChat, makeTextEnvelope } from "../../src/channels/base.js";

describe("makeTextEnvelope", () => {
  it("builds a text envelope with required fields", () => {
    const env = makeTextEnvelope({
      from: "user",
      content: "hello",
      channel: "cli",
    });
    expect(env.type).toBe("text");
    expect(env.from).toBe("user");
    expect(env.content).toBe("hello");
    expect(env.channel).toBe("cli");
    expect(env.metadata).toEqual({});
    expect(typeof env.id).toBe("string");
    expect(typeof env.ts).toBe("number");
  });

  it("preserves optional metadata, replyTo and id", () => {
    const env = makeTextEnvelope({
      from: "u1",
      content: "hi",
      channel: "ws",
      metadata: { chatId: "c1" },
      replyTo: "m1",
      id: "custom-id",
    });
    expect(env.metadata).toEqual({ chatId: "c1" });
    expect(env.replyTo).toBe("m1");
    expect(env.id).toBe("custom-id");
  });
});

describe("makeEnvelopeFromChat", () => {
  it("sets from to chatId by default", () => {
    const env = makeEnvelopeFromChat({
      channel: "websocket",
      chatId: "client-1",
      content: "ping",
    });
    expect(env.from).toBe("client-1");
    expect(env.metadata).toEqual({ chatId: "client-1" });
  });

  it("allows overriding from and extra metadata", () => {
    const env = makeEnvelopeFromChat({
      channel: "telegram",
      chatId: "chat-1",
      from: "user-1",
      content: "hello",
      metadata: { username: "alice" },
    });
    expect(env.from).toBe("user-1");
    expect(env.metadata).toEqual({ chatId: "chat-1", username: "alice" });
  });
});
