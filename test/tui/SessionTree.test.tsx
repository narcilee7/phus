// test/tui/SessionTree.test.tsx
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SessionTree } from "../../src/tui/components/SessionTree.js";
import type { PlanState, PlanSubagentState } from "../../src/tui/state.js";

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function makePlan(status: PlanState["status"] = "running"): PlanState {
  return {
    id: "p1",
    goal: "ship phase 5",
    status,
    steps: [],
    subagents: [],
  };
}

describe("SessionTree", () => {
  it("renders the current session as root", () => {
    const { lastFrame } = render(
      <SessionTree currentSessionId="tui:user" height={20} onClose={() => {}} />,
    );
    expect(lastFrame()!).toContain("tui:user");
    expect(lastFrame()!).toContain("Sessions");
  });

  it("renders subagents below the current session", () => {
    const subagents: PlanSubagentState[] = [
      { sessionId: "sub-aaa", label: "explore", goal: "scan", status: "running" },
      { sessionId: "sub-bbb", label: "verify", goal: "check", status: "completed" },
    ];
    const { lastFrame } = render(
      <SessionTree
        currentSessionId="tui:user"
        plan={makePlan()}
        subagents={subagents}
        height={20}
        onClose={() => {}}
      />,
    );
    expect(lastFrame()!).toContain("explore");
    expect(lastFrame()!).toContain("verify");
    expect(lastFrame()!).toContain("scan");
    expect(lastFrame()!).toContain("check");
  });

  it("navigates with arrow keys", async () => {
    const subagents: PlanSubagentState[] = [
      { sessionId: "sub-aaa", label: "a", goal: "ga", status: "running" },
      { sessionId: "sub-bbb", label: "b", goal: "gb", status: "running" },
    ];
    const { stdin, lastFrame } = render(
      <SessionTree
        currentSessionId="tui:user"
        subagents={subagents}
        plan={makePlan()}
        height={20}
        onClose={() => {}}
      />,
    );
    await wait(50);
    stdin.write("[B"); // down arrow
    await wait(50);
    expect(lastFrame()!).toBeTruthy();
  });

  it("calls onFocusSubagent when pressing Enter on a row", async () => {
    const onFocus = vi.fn();
    const subagents: PlanSubagentState[] = [
      { sessionId: "sub-aaa", label: "a", goal: "ga", status: "running" },
    ];
    const { stdin } = render(
      <SessionTree
        currentSessionId="tui:user"
        subagents={subagents}
        plan={makePlan()}
        height={20}
        onFocusSubagent={onFocus}
        onClose={() => {}}
      />,
    );
    await wait(50);
    stdin.write("[B"); // down to subagent row
    await wait(50);
    stdin.write("\r"); // Enter
    await wait(50);
    expect(onFocus).toHaveBeenCalledWith("sub-aaa");
  });

  it("closes on q", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <SessionTree currentSessionId="tui:user" height={20} onClose={onClose} />,
    );
    await wait(50);
    stdin.write("q");
    await wait(50);
    expect(onClose).toHaveBeenCalled();
  });
});
