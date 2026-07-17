// test/tui/PermissionPanel.test.tsx
// Independent permission panel rendering and keyboard behavior.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PermissionPanel } from "../../src/tui/components/permission-components/PermissionPanel.js";
import type { PermissionRequest } from "../../src/tui/state/state.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "p1",
    toolName: "bash",
    args: { command: "ls" },
    toolCallId: "tc-1",
    resolve: vi.fn(),
    ...overrides,
  };
}

describe("PermissionPanel", () => {
  it("renders tool name, risk level and choices", async () => {
    const { lastFrame } = render(<PermissionPanel request={makeRequest()} onResolve={vi.fn()} />);
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("bash");
    expect(frame).toContain("HIGH risk");
    expect(frame).toContain("[Y]es");
    expect(frame).toContain("[S]ession");
    expect(frame).toContain("[A]lways");
    expect(frame).toContain("[N]o");
    expect(frame).toContain("Esc");
  });

  it("shows args preview for non-write tools", async () => {
    const { lastFrame } = render(
      <PermissionPanel request={makeRequest({ toolName: "bash", args: { command: "echo hi" } })} onResolve={vi.fn()} />,
    );
    await wait();
    expect(lastFrame()!).toContain("echo hi");
  });

  it("shows diff preview for file_write", async () => {
    const { lastFrame } = render(
      <PermissionPanel
        request={makeRequest({
          toolName: "file_write",
          args: { path: "src/foo.ts", content: "new line" },
        })}
        onResolve={vi.fn()}
      />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("src/foo.ts");
    expect(frame).toContain("+ new line");
  });

  it("Y resolves allow=true once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("y");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "once");
  });

  it("S resolves allow=true session", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("s");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "session");
  });

  it("A resolves allow=true always", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("a");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "always");
  });

  it("N resolves allow=false once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("n");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(false, "once");
  });

  it("Enter resolves allow=true once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("\r");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(true, "once");
  });

  it("Escape resolves allow=false once", async () => {
    const onResolve = vi.fn();
    const { stdin } = render(<PermissionPanel request={makeRequest()} onResolve={onResolve} />);
    await wait();
    stdin.write("\x1b");
    await wait();
    expect(onResolve).toHaveBeenCalledWith(false, "once");
  });
});
