// test/tui/PermissionBar.test.tsx
// Inline permission bar keyboard behavior.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PermissionBar } from "../../src/tui/components/PermissionBar.js";
import type { PermissionRequest, RememberChoice } from "../../src/tui/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeRequest(): PermissionRequest {
  return {
    id: "p1",
    toolName: "bash",
    args: { command: "ls" },
    toolCallId: "tc-1",
    resolve: vi.fn(),
  };
}

describe("PermissionBar", () => {
  it("renders tool name and choices", async () => {
    const { lastFrame } = render(<PermissionBar request={makeRequest()} onResolve={vi.fn()} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("[Y]es");
    expect(frame).toContain("[S]ession");
    expect(frame).toContain("[A]lways");
    expect(frame).toContain("[N]o");
  });

  it("Y resolves allow=true once", async () => {
    const onResolve = vi.fn();
    const { stdin, lastFrame } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    expect(lastFrame()).toContain("[Y]es");
    stdin.write("y");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "once");
  });

  it("S resolves allow=true session", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("s");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "session");
  });

  it("A resolves allow=true always", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("a");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "always");
  });

  it("N resolves allow=false once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("n");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(false, "once");
  });

  it("Enter resolves allow=true once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("\r");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "once");
  });

  it("Escape resolves allow=false once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionBar request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("\x1b");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(false, "once");
  });
});
