// test/tui/ChatItemView.test.tsx
// ChatItemView rendering edge cases.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatItemView } from "../../src/tui/components/chat-components/ChatItemView.js";
import type { ChatItem } from "../../src/tui/state/state.js";

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

  it("renders a user message", async () => {
    const item: ChatItem = { id: "u1", kind: "user", ts: 0, text: "hello" };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("hello");
    expect(lastFrame()).toContain("❯");
  });

  it("shows a reasoning preview on assistant messages", async () => {
    const item: ChatItem = {
      id: "a3",
      kind: "assistant",
      ts: 0,
      text: "done",
      reasoning: "I should check the file first",
    };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("thinking");
    expect(lastFrame()).toContain("check the file");
  });

  it("renders a running tool call card with argument summary", async () => {
    const item: ChatItem = {
      id: "tc1",
      kind: "tool_call",
      ts: 0,
      toolName: "bash",
      toolCallId: "t1",
      args: { command: "ls -la" },
    };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("ls -la");
  });

  it("renders a successful tool result card", async () => {
    const item: ChatItem = {
      id: "tr1",
      kind: "tool_result",
      ts: 0,
      toolName: "bash",
      toolCallId: "t1",
      result: "foo.txt\nbar.txt",
      isError: false,
    };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("foo.txt");
  });

  it("renders an error tool result card", async () => {
    const item: ChatItem = {
      id: "tr2",
      kind: "tool_result",
      ts: 0,
      toolName: "bash",
      toolCallId: "t2",
      result: "command not found",
      isError: true,
    };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("command not found");
  });

  it("renders assistant metadata when available", async () => {
    const item: ChatItem = {
      id: "a4",
      kind: "assistant",
      ts: 0,
      text: "hello",
      model: "claude-sonnet-4",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.00123 },
    };
    const { lastFrame } = render(<ChatItemView item={item} />);
    await wait();
    expect(lastFrame()).toContain("claude-sonnet-4");
    expect(lastFrame()).toContain("150 tokens");
    expect(lastFrame()).toContain("$0.0012");
  });
});
