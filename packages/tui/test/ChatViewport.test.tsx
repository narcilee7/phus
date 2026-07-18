// test/tui/ChatViewport.test.tsx
// ChatViewport anchoring and scrolling behavior.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatViewport } from "../src/components/chat-components/ChatViewport.js";
import type { ChatItem } from "../src/state/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeItem(kind: ChatItem["kind"], text: string, id: string): ChatItem {
  return { id, kind, ts: 0, text };
}

describe("ChatViewport", () => {
  it("shows the newest item at the bottom when scrolled to bottom", async () => {
    const items: ChatItem[] = [
      makeItem("user", "first", "1"),
      makeItem("assistant", "second", "2"),
      makeItem("user", "third", "3"),
    ];
    const { lastFrame } = render(
      <ChatViewport
        items={items}
        busy={false}
        scrollOffset={0}
        hasNew={false}
        lastOp="idle"
        height={10}
      />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("first");
    expect(frame).toContain("second");
    expect(frame).toContain("third");
  });

  it("hides newest items when scrollOffset increases", async () => {
    const items: ChatItem[] = [
      makeItem("user", "first", "1"),
      makeItem("assistant", "second", "2"),
      makeItem("user", "third", "3"),
    ];
    const { lastFrame } = render(
      <ChatViewport
        items={items}
        busy={false}
        scrollOffset={1}
        hasNew={false}
        lastOp="idle"
        height={10}
      />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("first");
    expect(frame).toContain("second");
    expect(frame).not.toContain("third");
  });

  it("shows the new-messages indicator when scrolled up", async () => {
    const items: ChatItem[] = [
      makeItem("user", "first", "1"),
      makeItem("assistant", "second", "2"),
    ];
    const { lastFrame } = render(
      <ChatViewport
        items={items}
        busy={false}
        scrollOffset={1}
        hasNew={true}
        lastOp="idle"
        height={10}
      />,
    );
    await wait();
    expect(lastFrame()).toContain("new messages");
  });

  it("renders the busy spinner below items", async () => {
    const items: ChatItem[] = [makeItem("user", "hello", "1")];
    const { lastFrame } = render(
      <ChatViewport
        items={items}
        busy={true}
        scrollOffset={0}
        hasNew={false}
        lastOp="thinking"
        height={10}
      />,
    );
    await wait();
    expect(lastFrame()).toContain("thinking");
  });

  it("clamps scrollOffset to the item count", async () => {
    const items: ChatItem[] = [makeItem("user", "only", "1")];
    const { lastFrame } = render(
      <ChatViewport
        items={items}
        busy={false}
        scrollOffset={100}
        hasNew={false}
        lastOp="idle"
        height={10}
      />,
    );
    await wait();
    expect(lastFrame()).not.toContain("only");
  });
});
