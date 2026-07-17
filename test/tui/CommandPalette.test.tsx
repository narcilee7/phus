// test/tui/CommandPalette.test.tsx
// Command palette open/filter/select behavior.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { CommandPalette } from "../../src/tui/components/CommandPalette.js";
import { SLASH_COMMANDS } from "../../src/tui/commands.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));
const COMMAND_COUNT = SLASH_COMMANDS.length + 4; // + plan create/status/list/resume

const fakeFiles = Array.from({ length: 30 }, (_, i) => `file${String(i).padStart(2, "0")}.ts`);

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async () => fakeFiles),
  stat: vi.fn(async (path: string) => ({
    isDirectory: () => false,
    isFile: () => typeof path === "string" && !path.endsWith("/"),
  })),
}));

function makeAgent(): PhusAgent {
  return {
    getAllSkills: () => [],
    getTapeStats: () => ({ totalEntries: 0, sessions: {} }),
  } as any;
}

describe("CommandPalette", () => {
  it("renders slash commands by default", async () => {
    const { lastFrame } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={vi.fn()} />);
    await wait(200);
    const frame = lastFrame()!;
    expect(frame).toMatch(/\/[a-z]/);
  });

  it("filters commands when typing", async () => {
    const { stdin, lastFrame } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={vi.fn()} />);
    await wait(200);
    stdin.write("quit");
    await wait(100);
    const frame = lastFrame()!;
    expect(frame).toContain("/quit");
  });

  it("calls onSelect when Enter is pressed", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<CommandPalette agent={makeAgent()} onSelect={onSelect} onClose={vi.fn()} />);
    await wait(200);
    stdin.write("quit");
    await wait(100);
    stdin.write("\r");
    await wait(100);
    expect(onSelect).toHaveBeenCalled();
    const [value, action] = onSelect.mock.calls[0]!;
    expect(value).toContain("/quit");
    expect(action).toBe("insert");
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={onClose} />);
    await wait(200);
    stdin.write("\x1b");
    await wait(100);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Ctrl+C", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={onClose} />);
    await wait(200);
    stdin.write("\x03");
    await wait(100);
    expect(onClose).toHaveBeenCalled();
  });

  it("scrolls the result viewport when navigating past the visible window", async () => {
    const { stdin, lastFrame } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={vi.fn()} />);
    await wait(300);
    // The first visible items are slash commands; files start after them.
    let frame = lastFrame()!;
    expect(frame).toContain("/model");
    expect(frame).not.toContain("file00.ts");
    // Move down past the slash commands into the file list.
    for (let i = 0; i < COMMAND_COUNT + 4; i++) stdin.write("\x1b[B");
    await wait(200);
    frame = lastFrame()!;
    expect(frame).toContain("file04.ts");
  });

  it("pushes the list up one item at a time like Codex", async () => {
    const { stdin, lastFrame } = render(<CommandPalette agent={makeAgent()} onSelect={vi.fn()} onClose={vi.fn()} />);
    await wait(300);
    // COMMAND_COUNT slash commands, then file00 starts at index COMMAND_COUNT.
    for (let i = 0; i < COMMAND_COUNT; i++) stdin.write("\x1b[B");
    await wait(200);
    expect(lastFrame()).toContain("file00.ts");
    // One more down arrow should scroll the window up by exactly one item.
    stdin.write("\x1b[B");
    await wait(100);
    const frame = lastFrame()!;
    expect(frame).toContain("file01.ts");
  });

  it("clamps selection when the filtered list shrinks", async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(<CommandPalette agent={makeAgent()} onSelect={onSelect} onClose={vi.fn()} />);
    await wait(300);
    // Navigate far down into the file list.
    for (let i = 0; i < COMMAND_COUNT + 4; i++) stdin.write("\x1b[B");
    await wait(200);
    expect(lastFrame()).toContain("file04.ts");
    // Filter down to one slash command; the old high index must clamp to 0.
    stdin.write("quit");
    await wait(200);
    const frame = lastFrame()!;
    expect(frame).toContain("/quit");
    stdin.write("\r");
    await wait(100);
    expect(onSelect).toHaveBeenCalled();
    expect(String(onSelect.mock.calls[0]![0])).toContain("/quit");
  });
});
