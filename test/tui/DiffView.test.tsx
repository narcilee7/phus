// test/tui/DiffView.test.tsx
// Line-level diff rendering.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { DiffView } from "../../src/tui/components/diff-components/DiffView.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("DiffView", () => {
  it("renders added lines", async () => {
    const { lastFrame } = render(<DiffView oldText="" newText="hello" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("+");
    expect(frame).toContain("hello");
  });

  it("renders removed lines", async () => {
    const { lastFrame } = render(<DiffView oldText="hello" newText="" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("-");
    expect(frame).toContain("hello");
  });

  it("renders context lines", async () => {
    const { lastFrame } = render(<DiffView oldText="keep\nold" newText="keep\nnew" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("keep");
    expect(frame).toContain("old");
    expect(frame).toContain("new");
  });

  it("folds long diffs by default", async () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const newText = oldText + "\nextra";
    const { lastFrame } = render(<DiffView oldText={oldText} newText={newText} maxContextLines={6} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("more lines");
  });
});
