// test/tui/MultiLineInput.test.tsx
// Repro + regression tests for slash-command input behavior.

import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { MultiLineInput } from "../src/components/input-components/MultiLineInput.js";

import type { SuggestionItem } from "../src/components/input-components/MultiLineInput.js";

const SUGGESTIONS: SuggestionItem[] = [
  { name: "help", description: "show available commands" },
  { name: "clear", description: "clear chat area" },
  { name: "quit", description: "exit" },
  { name: "models", description: "list known models" },
  { name: "profiles", description: "list provider profiles" },
];
import type { MentionItem } from "../src/components/input-components/MultiLineInput.js";

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

  it("tab auto-submits when there is exactly one unique match", async () => {
    // Matches Claude Code / Codex / Kimi Code: type `/help`, Tab fills
    // and sends in one keystroke. The user explicitly reports Tab
    // "without Enter" as confusing — this eliminates that confusion.
    const onSubmit = vi.fn();
    const { stdin } = render(<ControlledInput onSubmit={onSubmit} />);
    await wait();
    stdin.write("/help"); // exact, unique match
    await wait();
    stdin.write("\t"); // tab
    await wait();
    expect(onSubmit).toHaveBeenCalledWith("/help");
  });

  it("tab only completes (does not submit) when there are multiple candidates", async () => {
    // When the popup is showing multiple options, Tab should fill the
    // selected one and leave the user to pick via ↓/↑ then Enter. We don't
    // want to surprise-submit a slash command the user is still choosing.
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<ControlledInput onSubmit={onSubmit} />);
    await wait();
    stdin.write("/"); // matches all 5 commands
    await wait();
    expect(lastFrame()).toContain("/help");
    expect(lastFrame()).toContain("/clear");
    stdin.write("\t"); // tab — should complete the highlighted one, not submit
    await wait();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("/help ");
  });

  it("tab advances the cursor to the end so follow-up typing appends", async () => {
    // Regression for the "stuck after Tab" bug: completion used to leave
    // the cursor mid-string, so typing after Tab inserted into the middle
    // of the completed command instead of the end.
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/h");
    await wait();
    stdin.write("\t"); // tab → "/help "
    await wait();
    stdin.write("abc"); // should append, not insert mid-word
    await wait(50);
    const frame = lastFrame()!;
    expect(frame).toContain("/help abc");
    expect(frame).not.toContain("/helabcp");
  });

  it("dropdown stays closed after Tab completes the only match", async () => {
    // After Tab completes /h → /help, the popup must close. If it stays
    // open and a second Tab re-completes the same command, the input looks
    // frozen — the bug reported by users.
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/h");
    await wait();
    stdin.write("\t");
    await wait();
    expect(lastFrame()).not.toContain("/clear");
    expect(lastFrame()).not.toContain("/quit");
    // Second Tab should be a no-op visually (no other suggestions to cycle).
    stdin.write("\t");
    await wait();
    expect(lastFrame()).not.toContain("/clear");
  });

  it("Enter completion also advances the cursor and closes the popup", async () => {
    // Enter on a partial match behaves like Tab — complete and let the
    // user keep typing the command's args.
    const { stdin, lastFrame } = render(<ControlledInput />);
    await wait();
    stdin.write("/h");
    await wait();
    stdin.write("\r"); // Enter (partial match, so it completes, not submits)
    await wait();
    stdin.write("more");
    await wait(50);
    const frame = lastFrame()!;
    expect(frame).toContain("/help more");
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

describe("MultiLineInput IME composition (known limitation)", () => {
  // Note: the IME composition debounce was removed because it added 30ms
  // latency to every keystroke while only partially mitigating the macOS
  // IME jitter (which is fundamentally a terminal/IME protocol issue, not
  // solvable inside an ink useInput handler). MultiLineInput now commits
  // every keystroke synchronously. Users who need CJK IME polish should
  // switch to a terminal with kitty keyboard protocol support (iTerm2,
  // WezTerm, kitty).

  it("commits every keystroke immediately (no latency added)", async () => {
    const onChange = vi.fn();
    function Probe() {
      const [value, setValue] = useState("");
      return (
        <MultiLineInput
          value={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
          onSubmit={vi.fn()}
          suggestions={SUGGESTIONS}
          mentionSuggestions={MENTION_SUGGESTIONS}
          isActive
        />
      );
    }
    const { stdin } = render(<Probe />);
    await wait();
    const callsBefore = onChange.mock.calls.length;
    stdin.write("h");
    stdin.write("i");
    await wait(50);
    const addedCalls = onChange.mock.calls.length - callsBefore;
    expect(addedCalls).toBe(2);
  });
});