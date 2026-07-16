// test/tui/ChatItemView.test.tsx
// ChatItemView rendering edge cases.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatItemView } from "../../src/tui/components/ChatItemView.js";
import type { ChatItem } from "../../src/tui/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("ChatItemView", () => {
  it("renders nothing for an empty system message", async () => {
    const item: ChatItem = { id: "s1", kind: "system", ts: 0, text: "   " };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toBe("");
  });

  it("renders a non-empty system message", async () => {
    const item: ChatItem = { id: "s2", kind: "system", ts: 0, text: "hello", level: "info" };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("hello");
  });

  it("renders nothing for an empty finalized assistant message", async () => {
    const item: ChatItem = { id: "a1", kind: "assistant", ts: 0, text: "   ", isStreaming: false };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toBe("");
  });

  it("shows the assistant icon while streaming even with no text", async () => {
    const item: ChatItem = { id: "a2", kind: "assistant", ts: 0, text: "", isStreaming: true };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("⛰");
  });
});
