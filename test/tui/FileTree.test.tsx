// test/tui/FileTree.test.tsx
// Keyboard navigation and preview behavior of the file tree sidebar.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { FileTree } from "../../src/tui/components/FileTree.js";

const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));

vi.mock("../../src/tui/components/CommandPalette.js", () => ({
  scanFiles: vi.fn(async () => ["src/index.ts", "src/lib/foo.ts", "README.md"]),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => `content of ${path}`),
}));

describe("FileTree", () => {
  it("renders scanned files", async () => {
    const { lastFrame } = render(
      <FileTree height={20} onInsert={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    await wait(200);
    const frame = lastFrame()!;
    expect(frame).toContain("README.md");
    expect(frame).toContain("src");
  });

  it("down arrow moves selection to next visible node", async () => {
    const { stdin, lastFrame } = render(
      <FileTree height={20} onInsert={vi.fn()} onPreview={vi.fn()} onClose={vi.fn()} />,
    );
    await wait(200);
    stdin.write("\x1b[B"); // down arrow
    await wait(100);
    const frame = lastFrame()!;
    expect(frame).toContain("src");
  });

  it("Enter on a file inserts @path and closes sidebar", async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <FileTree height={20} onInsert={onInsert} onPreview={vi.fn()} onClose={onClose} />,
    );
    await wait(200);
    // Navigate down until README.md is selected (past src dir and its children).
    for (let i = 0; i < 5; i++) stdin.write("\x1b[B");
    await wait(100);
    stdin.write("\r");
    await wait(100);
    expect(onInsert).toHaveBeenCalledWith("@README.md ");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes sidebar", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <FileTree height={20} onInsert={vi.fn()} onPreview={vi.fn()} onClose={onClose} />,
    );
    await wait(200);
    stdin.write("\x1b");
    await wait(100);
    expect(onClose).toHaveBeenCalled();
  });

  it("Space on a file previews its content", async () => {
    const onPreview = vi.fn();
    const { stdin } = render(
      <FileTree height={20} onInsert={vi.fn()} onPreview={onPreview} onClose={vi.fn()} />,
    );
    await wait(200);
    // Navigate to README.md.
    for (let i = 0; i < 5; i++) stdin.write("\x1b[B");
    await wait(100);
    stdin.write(" ");
    await wait(100);
    expect(onPreview).toHaveBeenCalled();
    expect(String(onPreview.mock.calls[0]![0])).toContain("content of README.md");
  });
});
