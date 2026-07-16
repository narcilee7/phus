// test/tui/MultiLineInput.test.tsx
// Repro + regression tests for slash-command input behavior.

import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { MultiLineInput } from "../../src/tui/components/MultiLineInput.js";

const SUGGESTIONS = ["help", "clear", "quit", "models", "profiles"];
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function ControlledInput(props: {
  suggestions?: string[];
  onSubmit?: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MultiLineInput
      value={value}
      onChange={setValue}
      onSubmit={props.onSubmit ?? vi.fn()}
      suggestions={props.suggestions ?? SUGGESTIONS}
      placeholder="type a message"
      isActive
    />
  );
}

describe("MultiLineInput slash behavior", () => {
  it("does not show suggestions for empty input", async () => {
    const { lastFrame } = render(<ControlledInput />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).not.toContain("/help");
    expect(frame).toContain("type a message");
  });

  it("shows all suggestions for a bare slash", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/");
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("/help");
    expect(frame).toContain("/clear");
    expect(frame).toContain("/");
  });

  it("shows filtered suggestions after typing /h", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/h");
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("/help");
    expect(frame).not.toContain("/clear");
  });

  it("can backspace (\\x08) after typing a bare slash", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/");
    await wait();
    expect(lastFrame()).toContain("/");
    stdin.write("\x08"); // backspace
    await wait();
    const frame = lastFrame()!;
    expect(frame).not.toContain("/");
  });

  it("can delete (\\x7f) after typing a bare slash", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/");
    await wait();
    expect(lastFrame()).toContain("/");
    stdin.write("\x7f"); // Mac Delete key (treated as backward delete)
    await wait();
    const frame = lastFrame()!;
    expect(frame).not.toContain("/");
  });

  it("can continue typing after a bare slash", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/");
    await wait();
    stdin.write("h");
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("/h");
    expect(frame).toContain("/help");
  });

  it("tab completes the selected suggestion", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/h");
    await wait();
    expect(lastFrame()).toContain("/help");
    stdin.write("\t"); // tab
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("/help");
    expect(frame).not.toContain("/clear"); // dropdown should close after completion
  });
});
