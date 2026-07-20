// test/steering.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { PiSteeringInbox } from "@phus/core/runtime/steering/index.js";
import type { Envelope } from "../src/types/channel/index";

function env(content: string, from = "system"): Envelope {
  return {
    id: crypto.randomUUID(),
    from,
    content,
    type: "text",
    channel: "system",
    metadata: {},
    ts: Date.now(),
  };
}

describe("PiSteeringInbox", () => {
  let inbox: PiSteeringInbox;

  beforeEach(() => {
    inbox = new PiSteeringInbox();
  });

  it("starts empty", () => {
    expect(inbox.messageCount()).toBe(0);
    expect(inbox.peek()).toEqual([]);
  });

  it("enqueues in FIFO order", async () => {
    await inbox.enqueueMessage(env("first"));
    await inbox.enqueueMessage(env("second"));
    await inbox.enqueueMessage(env("third", "heartbeat"));
    expect(inbox.messageCount()).toBe(3);
    expect(inbox.peek().map((e) => e.content)).toEqual(["first", "second", "third"]);
  });

  it("drain returns all queued messages and clears queue", async () => {
    await inbox.enqueueMessage(env("a"));
    await inbox.enqueueMessage(env("b"));
    const drained = await inbox.drainMessages();
    expect(drained.map((e) => e.content)).toEqual(["a", "b"]);
    expect(inbox.messageCount()).toBe(0);
    expect(inbox.peek()).toEqual([]);
  });

  it("drain on empty queue returns empty array (not null)", async () => {
    const drained = await inbox.drainMessages();
    expect(drained).toEqual([]);
  });

  it("peek returns copy (mutations don't affect queue)", async () => {
    await inbox.enqueueMessage(env("x"));
    const peeked = inbox.peek();
    peeked.pop();
    expect(inbox.messageCount()).toBe(1);
  });
});
