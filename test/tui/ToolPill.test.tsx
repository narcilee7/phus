// test/tui/ToolPill.test.tsx
// ToolPill rendering for running / success / error states.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ToolPill } from "../../src/tui/components/tool-components/ToolPill.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("ToolPill", () => {
  it("renders running state", async () => {
    const { lastFrame } = render(<ToolPill name="bash" status="running" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("running");
  });

  it("renders success with duration", async () => {
    const { lastFrame } = render(<ToolPill name="file_read" status="success" durationMs={42} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("file_read");
    expect(frame).toContain("42ms");
  });

  it("renders error state", async () => {
    const { lastFrame } = render(<ToolPill name="bash" status="error" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("error");
  });
});
