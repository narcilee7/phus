// test/tui/layout-context.test.tsx
// Regression tests for the bottom-overlay row reservation used by App.tsx
// to prevent suggestion/mention dropdowns from overlapping other UI.

import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { TuiLayoutProvider, useTuiLayout } from "../../src/tui/layout-context.js";
import {
  MultiLineInput,
  type SuggestionItem,
  type MentionItem,
} from "../../src/tui/components/MultiLineInput.js";

const SUGGESTIONS: SuggestionItem[] = [
  { name: "help", description: "show commands" },
  { name: "clear", description: "clear chat" },
  { name: "quit", description: "exit" },
  { name: "models", description: "list models" },
  { name: "profiles", description: "list profiles" },
];

const MENTIONS: MentionItem[] = [
  { target: "src/foo.ts", type: "file" },
  { target: "src/bar.ts", type: "file" },
  { target: "my-skill", type: "skill" },
];

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function ControlledInput(props: {
  suggestions?: SuggestionItem[];
  mentionSuggestions?: MentionItem[];
}) {
  const [value, setValue] = useState("");
  return (
    <MultiLineInput
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      suggestions={props.suggestions ?? SUGGESTIONS}
      mentionSuggestions={props.mentionSuggestions ?? MENTIONS}
      isActive
    />
  );
}

function OverlayRecorder() {
  const { bottomOverlayRows } = useTuiLayout();
  return <Text>overlay={bottomOverlayRows}</Text>;
}

describe("TuiLayoutProvider overlay reservation", () => {
  it("starts with zero reserved rows", async () => {
    const { lastFrame } = render(
      <TuiLayoutProvider>
        <OverlayRecorder />
      </TuiLayoutProvider>,
    );
    await wait();
    expect(lastFrame()).toContain("overlay=0");
  });

  it("reserves rows while slash suggestions are visible", async () => {
    const { lastFrame, stdin } = render(
      <TuiLayoutProvider>
        <OverlayRecorder />
        <ControlledInput />
      </TuiLayoutProvider>,
    );
    await wait();
    stdin.write("/");
    await wait();
    // VISIBLE_SUGGESTIONS (4) + marginTop (1) + hint row (1) = 6
    expect(lastFrame()).toContain("overlay=6");
  });

  it("reserves rows while mention suggestions are visible", async () => {
    const { lastFrame, stdin } = render(
      <TuiLayoutProvider>
        <OverlayRecorder />
        <ControlledInput mentionSuggestions={MENTIONS} suggestions={[]} />
      </TuiLayoutProvider>,
    );
    await wait();
    stdin.write("@");
    await wait();
    // 3 mention items + marginTop + hint = 5
    expect(lastFrame()).toContain("overlay=5");
  });

  it("clears reserved rows when the dropdown closes", async () => {
    const { lastFrame, stdin } = render(
      <TuiLayoutProvider>
        <OverlayRecorder />
        <ControlledInput />
      </TuiLayoutProvider>,
    );
    await wait();
    stdin.write("/");
    await wait();
    expect(lastFrame()).toContain("overlay=6");
    stdin.write("\x1b"); // escape closes suggestions
    await wait();
    expect(lastFrame()).toContain("overlay=0");
  });
});
