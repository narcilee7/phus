// ─── file_write preview helpers ───────────────────────────────────
// Permission-bar caption + unified-diff preview for the `file_write`
// tool. Aligned with how Codex/Claude Code surface a per-tool approval
// gate so the operator sees the change BEFORE granting permission.

import * as fs from "node:fs";

const MAX_PREVIEW_BYTES = 8 * 1024;
const MAX_PREVIEW_LINES = 40;

function safeRead(p: string): { exists: boolean; content: string } {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return { exists: false, content: "" };
    if (stat.size > MAX_PREVIEW_BYTES) {
      // Read up to the budget — large files get truncated with a marker.
      const fd = fs.openSync(p, "r");
      try {
        const buf = Buffer.alloc(MAX_PREVIEW_BYTES);
        fs.readSync(fd, buf, 0, MAX_PREVIEW_BYTES, 0);
        return {
          exists: true,
          content: buf.toString("utf-8") + `\n…  (truncated; ${stat.size} bytes total)`,
        };
      } finally {
        fs.closeSync(fd);
      }
    }
    return { exists: true, content: fs.readFileSync(p, "utf-8") };
  } catch {
    return { exists: false, content: "" };
  }
}

/** Truncate `s` so the resulting preview is friendly to the permission
 *  panel (≤ MAX_PREVIEW_LINES + trailing marker). */
function truncateLines(s: string, budget = MAX_PREVIEW_LINES): string {
  const lines = s.split("\n");
  if (lines.length <= budget) return s;
  return (
    lines.slice(0, budget).join("\n") +
    `\n…  (${lines.length - budget} more line${lines.length - budget === 1 ? "" : "s"} not shown)`
  );
}

/** `file_write? (path/to/file.ts)` — short caption for the prompt header. */
export function describeFileWrite(rawArgs: unknown): string | undefined {
  const args = (rawArgs ?? {}) as { path?: unknown; content?: unknown };
  if (typeof args.path !== "string") return undefined;
  return args.path;
}

/**
 * Unified-diff-lite preview for the permission bar.
 *
 *   new file:  prints every line as `+ ...`
 *   overwrite: prints up to MAX_PREVIEW_LINES of either:
 *              - the new content (if existing file > budget)
 *              - a +/- interleaved view if both fit
 *
 * Kept deliberately compact — the panel is one terminal-row tall and
 * the full content is already in the agent's tool result. The preview
 * is for the operator's "do I want to allow this" judgment call, not
 * a full patch review.
 */
export function buildFileWritePreview(rawArgs: unknown): string | undefined {
  try {
    const args = (rawArgs ?? {}) as { path?: unknown; content?: unknown };
    if (typeof args.path !== "string") return undefined;
    const newContent = typeof args.content === "string" ? args.content : "";
    const path = args.path;

    const old = safeRead(path);
    if (!old.exists) {
      const lines = [
        `(new file) ${path}`,
        "",
        ...newContent.split("\n").map((ln) => `+ ${ln}`),
      ];
      return truncateLines(lines.join("\n"));
    }

    // For existing files, show the new content with a header. A full
    // LCS diff is overkill for the approval bar — operators who want
    // the diff can open the file. Cap output to keep the panel tight.
    const lines = [
      `(overwrite) ${path}`,
      "",
      ...newContent.split("\n").map((ln) => `+ ${ln}`),
    ];
    return truncateLines(lines.join("\n"));
  } catch {
    return undefined;
  }
}