// test/tui/PlanPanel.test.tsx
import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PlanPanel } from "../../src/tui/components/agent-components/PlanPanel.js";

function makePlan(status: "pending" | "running" | "paused" | "completed" | "failed") {
  return {
    id: "p1",
    goal: "refactor auth",
    status,
    steps: [
      { id: "s1", description: "analyze code", status: "completed" as const },
      { id: "s2", description: "write tests", status: "running" as const },
      { id: "s3", description: "run tests", status: "pending" as const },
    ],
    currentStepId: "s2",
  };
}

describe("PlanPanel", () => {
  it("renders the goal and progress", () => {
    const { lastFrame } = render(<PlanPanel plan={makePlan("running")} />);
    const frame = lastFrame()!;
    expect(frame).toContain("refactor auth");
    expect(frame).toContain("1/3");
  });

  it("shows the current step when running", () => {
    const { lastFrame } = render(<PlanPanel plan={makePlan("running")} />);
    const frame = lastFrame()!;
    expect(frame).toContain("write tests");
  });

  it("renders all step descriptions", () => {
    const { lastFrame } = render(<PlanPanel plan={makePlan("running")} />);
    const frame = lastFrame()!;
    expect(frame).toContain("analyze code");
    expect(frame).toContain("write tests");
    expect(frame).toContain("run tests");
  });

  it("shows a completed icon for completed plans", () => {
    const { lastFrame } = render(<PlanPanel plan={makePlan("completed")} />);
    expect(lastFrame()!).toContain("✓ Plan:");
  });

  it("shows a failed icon for failed plans", () => {
    const { lastFrame } = render(<PlanPanel plan={makePlan("failed")} />);
    expect(lastFrame()!).toContain("✗ Plan:");
  });
});
