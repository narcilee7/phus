// test/tui/CodeBlock.test.tsx
// Code block rendering and action button tests.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { CodeBlock } from "../../src/tui/components/CodeBlock.js";
import {
  CodeActionContext,
  type CodeBlockAction,
} from "../../src/tui/components/CodeActionContext.js";
import { TuiFocusContext } from "../../src/tui/components/TuiFocusContext.js";
import { detectInterpreter, runCode } from "../../src/tui/code-actions.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function renderWithAction(
  ui: React.ReactElement,
  opts: { focusedId?: string | null; onAction?: (a: CodeBlockAction) => void } = {},
) {
  const focusedId = opts.focusedId ?? null;
  return render(
    <TuiFocusContext.Provider
      value={{
        focusedId,
        focusedKind: focusedId ? "codeblock" : null,
        setFocused: vi.fn(),
      }}
    >
      <CodeActionContext.Provider
        value={{
          onAction: opts.onAction ?? vi.fn(),
        }}
      >
        {ui}
      </CodeActionContext.Provider>
    </TuiFocusContext.Provider>,
  );
}

describe("CodeBlock", () => {
  it("renders language label, code and action hints", async () => {
    const { lastFrame } = renderWithAction(
      <CodeBlock code="const x = 1;" language="typescript" id="cb1" />,
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("typescript");
    expect(frame).toContain("const x = 1;");
    expect(frame).toContain("copy(c)");
    expect(frame).toContain("run(r)");
    expect(frame).toContain("insert(i)");
  });

  it("shows action hints when focused", async () => {
    const { lastFrame } = renderWithAction(
      <CodeBlock code="echo hi" language="bash" id="cb1" />,
      { focusedId: "cb1" },
    );
    await wait();
    const frame = lastFrame()!;
    expect(frame).toContain("copy(c)");
    expect(frame).toContain("run(r)");
    expect(frame).toContain("insert(i)");
  });

  it("triggers copy action when focused and c is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <CodeBlock code="echo hi" language="bash" id="cb1" />,
      { focusedId: "cb1", onAction },
    );
    await wait();
    stdin.write("c");
    await wait();
    expect(onAction).toHaveBeenCalledWith({ type: "copy", code: "echo hi" });
  });

  it("triggers run action when focused and r is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <CodeBlock code="echo hi" language="bash" id="cb1" />,
      { focusedId: "cb1", onAction },
    );
    await wait();
    stdin.write("r");
    await wait();
    expect(onAction).toHaveBeenCalledWith({
      type: "run",
      language: "bash",
      code: "echo hi",
    });
  });

  it("triggers insert action when focused and i is pressed", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <CodeBlock code="echo hi" language="bash" id="cb1" />,
      { focusedId: "cb1", onAction },
    );
    await wait();
    stdin.write("i");
    await wait();
    expect(onAction).toHaveBeenCalledWith({ type: "insert", code: "echo hi" });
  });

  it("ignores action keys when not focused", async () => {
    const onAction = vi.fn();
    const { stdin } = renderWithAction(
      <CodeBlock code="echo hi" language="bash" id="cb1" />,
      { focusedId: null, onAction },
    );
    await wait();
    stdin.write("c");
    await wait();
    stdin.write("r");
    await wait();
    stdin.write("i");
    await wait();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("code-actions", () => {
  it("detects bash and python interpreters", () => {
    expect(detectInterpreter("bash")?.cmd).toBe("bash");
    expect(detectInterpreter("sh")?.cmd).toBe("bash");
    expect(detectInterpreter("shell")?.cmd).toBe("bash");
    expect(detectInterpreter("zsh")?.cmd).toBe("bash");
    expect(detectInterpreter("python")?.cmd).toBe("python3");
    expect(detectInterpreter("py")?.cmd).toBe("python3");
    expect(detectInterpreter("typescript")).toBeUndefined();
  });

  it("runs bash code and returns stdout", async () => {
    const { output, exitCode } = await runCode("bash", "echo hello");
    expect(exitCode).toBe(0);
    expect(output).toContain("hello");
  });

  it("returns non-zero exit code for failing bash", async () => {
    const { output, exitCode } = await runCode("bash", "exit 3");
    expect(exitCode).toBe(3);
    expect(output).toBe("");
  });

  it("captures stderr in output", async () => {
    const { output, exitCode } = await runCode("bash", "echo err >&2; exit 1");
    expect(exitCode).toBe(1);
    expect(output).toContain("err");
    expect(output).toContain("--- stderr ---");
  });
});
