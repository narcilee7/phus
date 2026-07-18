// test/tui/format-result.test.ts
// Regression for the bash-result-renders-as-JSON bug. The Pi AgentResultContent
// shape `{ content: [{ type: "text", text: "..." }] }` must be unwrapped to
// the inner text, not JSON.stringify'd.

import { describe, expect, it } from "vitest";
import { formatToolResult } from "../src/components/tool-components/format-result.js";

describe("formatToolResult", () => {
  it("returns empty string for undefined/null", () => {
    expect(formatToolResult(undefined)).toBe("");
    expect(formatToolResult(null)).toBe("");
  });

  it("returns string values verbatim", () => {
    expect(formatToolResult("hello")).toBe("hello");
    expect(formatToolResult("")).toBe("");
  });

  it("unwraps Pi AgentResultContent: { content: [{ type: 'text', text }] }", () => {
    // This is the exact shape bash / file_read return. Before the fix,
    // the { content: [...] } array fell through to JSON.stringify.
    const result = {
      content: [{ type: "text", text: "// src/tui/events.ts\n// map events to state" }],
      details: { stdout: "// src/tui/events.ts\n// map events to state", stderr: "", durationMs: 37 },
    };
    expect(formatToolResult(result)).toBe("// src/tui/events.ts\n// map events to state");
  });

  it("joins multiple text segments", () => {
    const result = {
      content: [
        { type: "text", text: "first " },
        { type: "text", text: "second" },
      ],
    };
    expect(formatToolResult(result)).toBe("first second");
  });

  it("falls back to stdout when content array is missing", () => {
    expect(formatToolResult({ stdout: "from stdout" })).toBe("from stdout");
  });

  it("falls back to stderr when stdout is empty", () => {
    expect(formatToolResult({ stdout: "", stderr: "from stderr" })).toBe("from stderr");
  });

  it("JSON.stringify unrecognized shapes (last resort)", () => {
    expect(formatToolResult({ something: "else" })).toBe(
      JSON.stringify({ something: "else" }, null, 2),
    );
  });
});
