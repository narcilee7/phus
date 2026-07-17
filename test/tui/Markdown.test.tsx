// test/tui/Markdown.test.tsx
// Markdown-to-Ink rendering tests.

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Markdown } from "../../src/tui/components/rich-text-components/Markdown.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("Markdown", () => {
  it("renders plain paragraphs", async () => {
    const { lastFrame } = render(<Markdown content="hello world" />);
    await wait();
    expect(lastFrame()).toContain("hello world");
  });

  it("renders headings with hashes", async () => {
    const { lastFrame } = render(<Markdown content="# Title" />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("# Title");
  });

  it("renders bold text", async () => {
    const { lastFrame } = render(<Markdown content="**bold**" />);
    await wait();
    expect(lastFrame()).toContain("bold");
  });

  it("renders italic text", async () => {
    const { lastFrame } = render(<Markdown content="*italic*" />);
    await wait();
    expect(lastFrame()).toContain("italic");
  });

  it("renders inline code", async () => {
    const { lastFrame } = render(<Markdown content="`code`" />);
    await wait();
    expect(lastFrame()).toContain("code");
  });

  it("renders code blocks with language label", async () => {
    const { lastFrame } = render(
      <Markdown content={"```typescript\nconst x = 1;\n```"} />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("typescript");
    expect(frame).toContain("const");
    expect(frame).toContain("x");
  });

  it("renders unordered lists", async () => {
    const { lastFrame } = render(<Markdown content={"- one\n- two"} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("one");
    expect(frame).toContain("two");
  });

  it("renders ordered lists", async () => {
    const { lastFrame } = render(<Markdown content={"1. first\n2. second"} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("first");
    expect(frame).toContain("second");
  });

  it("renders blockquotes", async () => {
    const { lastFrame } = render(<Markdown content="> quoted" />);
    await wait();
    expect(lastFrame()).toContain("quoted");
  });

  it("renders tables", async () => {
    const { lastFrame } = render(
      <Markdown content={"| a | b |\n|---|---|\n| 1 | 2 |"} />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("a");
    expect(frame).toContain("b");
    expect(frame).toContain("1");
  });

  it("skips empty list items", async () => {
    const { lastFrame } = render(<Markdown content={"- one\n- \n- two"} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("one");
    expect(frame).toContain("two");
    // A list with only an empty item should render no bullet at all.
    const { lastFrame: emptyLastFrame } = render(<Markdown content={"- "} />);
    await wait();
    expect(emptyLastFrame()).not.toContain("•");
  });
});
