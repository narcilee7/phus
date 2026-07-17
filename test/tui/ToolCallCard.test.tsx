// test/tui/ToolCallCard.test.tsx
// Inline tool-call lifecycle card tests.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ToolCallCard } from "../../src/tui/components/ToolCallCard.js";
import { TuiFocusContext } from "../../src/tui/components/TuiFocusContext.js";
import type { ChatItem } from "../../src/tui/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeItem(overrides: Partial<ChatItem> & { kind: "tool_call" }): ChatItem {
  return {
    id: "tc-1",
    kind: "tool_call",
    ts: Date.now(),
    toolCallId: "tc-1",
    toolName: "bash",
    args: {},
    ...overrides,
  };
}

function renderWithFocus(
  ui: React.ReactElement,
  opts: { focusedId?: string | null } = {},
) {
  const focusedId = opts.focusedId ?? null;
  return render(
    <TuiFocusContext.Provider
      value={{
        focusedId,
        focusedKind: focusedId ? "toolcall" : null,
        setFocused: vi.fn(),
      }}
    >
      {ui}
    </TuiFocusContext.Provider>,
  );
}

describe("ToolCallCard", () => {
  it("renders running state with tool name and args summary", async () => {
    const item = makeItem({
      toolName: "bash",
      args: { command: "echo hello" },
    });
    const { lastFrame } = renderWithFocus(<ToolCallCard item={item} id="t1" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("echo hello");
  });

  it("renders success state with duration", async () => {
    const item = makeItem({
      toolName: "bash",
      args: { command: "echo hello" },
      result: "hello",
      isError: false,
      durationMs: 42,
    });
    const { lastFrame } = renderWithFocus(<ToolCallCard item={item} id="t1" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("42ms");
    expect(frame).toContain("hello");
  });

  it("renders error state with result summary", async () => {
    const item = makeItem({
      toolName: "bash",
      args: { command: "exit 1" },
      result: "something went wrong",
      isError: true,
    });
    const { lastFrame } = renderWithFocus(<ToolCallCard item={item} id="t1" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("something went wrong");
  });

  it("renders file_write diff review inline", async () => {
    const item = makeItem({
      toolName: "file_write",
      args: { path: "src/foo.ts", content: "new" },
      result: "ok",
      isError: false,
    });
    const snapshots = new Map([["tc-1", { path: "src/foo.ts", content: "old" }]]);
    const { lastFrame } = renderWithFocus(
      <ToolCallCard item={item} fileSnapshots={snapshots} id="t1" />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("src/foo.ts");
    expect(frame).toContain("accept(a)");
    expect(frame).toContain("- old");
    expect(frame).toContain("+ new");
  });

  it("expands and collapses result on Enter/Space when focused", async () => {
    const longResult = "a".repeat(300);
    const item = makeItem({
      toolName: "bash",
      args: { command: "echo hello" },
      result: longResult,
      isError: false,
    });
    const { stdin, lastFrame } = renderWithFocus(
      <ToolCallCard item={item} id="t1" />,
      { focusedId: "t1" },
    );
    await wait();
    expect(lastFrame()!).toContain("… Enter/Space expand");
    stdin.write("\r");
    await wait();
    const expandedFrame = lastFrame()!;
    expect(expandedFrame).toContain("a".repeat(20));
    expect(expandedFrame).toContain("Enter/Space collapse");
  });
});
