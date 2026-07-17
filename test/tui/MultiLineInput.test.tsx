// test/tui/MultiLineInput.test.tsx
// Repro + regression tests for slash-command input behavior.

import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { MultiLineInput } from "../../src/tui/components/input-components/MultiLineInput.js";

import type { SuggestionItem } from "../../src/tui/components/input-components/MultiLineInput.js";

const SUGGESTIONS: SuggestionItem[] = [
  { name: "help", description: "show available commands" },
  { name: "clear", description: "clear chat area" },
  { name: "quit", description: "exit" },
  { name: "models", description: "list known models" },
  { name: "profiles", description: "list provider profiles" },
];
import type { MentionItem } from "../../src/tui/components/input-components/MultiLineInput.js";

const MENTION_SUGGESTIONS: MentionItem[] = [
  { target: "src/foo.ts", type: "file" },
  { target: "src/bar.ts", type: "file" },
  { target: "README.md", type: "file" },
];
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function ControlledInput(props: {
  suggestions?: SuggestionItem[];
  mentionSuggestions?: MentionItem[];
  onSubmit?: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MultiLineInput
      value={value}
      onChange={setValue}
      onSubmit={props.onSubmit ?? vi.fn()}
      suggestions={props.suggestions ?? SUGGESTIONS}
      mentionSuggestions={props.mentionSuggestions ?? MENTION_SUGGESTIONS}
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

  it("submits on Enter when typing normally", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<ControlledInput onSubmit={onSubmit} />);
    await wait();
    stdin.write("hello");
    await wait(100);
    stdin.write("\r");
    await wait();
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("inserts newline instead of submitting during rapid paste", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<ControlledInput onSubmit={onSubmit} />);
    await wait();
    // Simulate paste: characters arrive back-to-back, then a newline.
    stdin.write("hello");
    stdin.write("\r");
    await wait();
    expect(lastFrame()).toContain("hello\n");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("MultiLineInput @mention behavior", () => {
  it("shows file suggestions after typing @", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("@");
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("@src/foo.ts");
    expect(frame).toContain("@README.md");
  });

  it("filters file suggestions after typing @src/f", async () => {
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("@src/f");
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("@src/foo.ts");
    expect(frame).not.toContain("@README.md");
  });

  it("tab completes a mention", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<ControlledInput onSubmit={onSubmit} />);
    await wait();
    stdin.write("@src/f");
    await wait();
    stdin.write("\t");
    await wait();
    stdin.write("\r");
    await wait();
    expect(onSubmit).toHaveBeenCalledWith("@src/foo.ts ");
  });
});
