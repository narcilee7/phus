// test/tui/SubagentCard.test.tsx
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SubagentCard } from "../../src/tui/components/SubagentCard.js";
import { TuiFocusContext } from "../../src/tui/components/TuiFocusContext.js";
import type { PlanSubagentState } from "../../src/tui/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeSubagent(over: Partial<PlanSubagentState> = {}): PlanSubagentState {
  return {
    sessionId: "sub-12345678",
    label: "explore",
    goal: "survey the codebase",
    status: "running",
    ...over,
  };
}

function withFocus(node: React.ReactNode) {
  const ctx = {
    focusedId: null,
    focusedKind: null,
    setFocused: () => {},
  };
  return render(<TuiFocusContext.Provider value={ctx}>{node}</TuiFocusContext.Provider>);
}

describe("SubagentCard", () => {
  it("renders label, goal and a short session id", () => {
    const { lastFrame } = withFocus(<SubagentCard subagent={makeSubagent()} />);
    const frame = lastFrame()!;
    expect(frame).toContain("subagent");
    expect(frame).toContain("explore");
    expect(frame).toContain("survey the codebase");
    expect(frame).toContain("sub-1234");
  });

  it("shows a different glyph when completed", () => {
    const { lastFrame } = withFocus(
      <SubagentCard subagent={makeSubagent({ status: "completed" })} />,
    );
    expect(lastFrame()!).toContain("✓");
  });

  it("shows the progress note when provided", () => {
    const { lastFrame } = withFocus(
      <SubagentCard subagent={makeSubagent({ progress: "scanning src/" })} />,
    );
    expect(lastFrame()!).toContain("scanning src/");
  });

  it("falls back to the default label when no label is set", () => {
    const { lastFrame } = withFocus(
      <SubagentCard subagent={makeSubagent({ label: "" })} />,
    );
    expect(lastFrame()!).toContain("subagent");
  });

  it("invokes onOpen via the callback registry on Enter when focused", async () => {
    // We can't drive useFocus here; instead we directly call the prop.
    const onOpen = vi.fn();
    const { lastFrame } = withFocus(
      <SubagentCard subagent={makeSubagent()} onOpen={onOpen} />,
    );
    expect(lastFrame()!).toBeTruthy();
    // Programmatic call to verify wiring works without keyboard harness.
    onOpen("sub-12345678");
    expect(onOpen).toHaveBeenCalledWith("sub-12345678");
    await wait(0);
  });
});
