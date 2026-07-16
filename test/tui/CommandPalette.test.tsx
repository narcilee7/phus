// test/tui/CommandPalette.test.tsx
// Command palette open/filter/select behavior.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { CommandPalette } from "../../src/tui/components/CommandPalette.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));

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
});
