// src/tui/components/tool-components/format-result.ts
// Shared formatter for tool result bodies. Both the call summary and
// the standalone result card use it so callers always see the same shape:
//   undefined/null → empty string
//   string         → verbatim
//   { content: [{ text }] } (Pi AgentResultContent shape)
//                 → join the text segments
//   { stdout, stderr }     → prefer stdout, fall back to stderr
//   plain text             → verbatim
//   anything else          → JSON.stringify, then a String() fallback

const MAX_RESULT_CHARS = 200;

export interface AgentToolResultLike {
  content?: Array<{ type?: string; text?: unknown } | string> | string;
  details?: unknown;
  stdout?: unknown;
  stderr?: unknown;
}

export function formatToolResult(value: unknown): string {
  if (value === undefined || value === null) return "";

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    const obj = value as AgentToolResultLike;

    // Pi AgentResultContent: { content: [{ type: "text", text: "..." }] }
    if (Array.isArray(obj.content)) {
      const texts = obj.content
        .map((c) => (typeof c === "object" && c !== null && typeof c.text === "string" ? c.text : undefined))
        .filter((t): t is string => typeof t === "string");
      if (texts.length > 0) return texts.join("");
    }

    // Alternative shapes some tools return directly.
    if (typeof obj.stdout === "string" && obj.stdout.length > 0) return obj.stdout;
    if (typeof obj.stderr === "string" && obj.stderr.length > 0) return obj.stderr;
    if (typeof obj.content === "string") return obj.content;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Truncate a formatted tool result body to a one-line preview. */
export function previewToolResult(formatted: string): string {
  return truncate(formatted, MAX_RESULT_CHARS);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
