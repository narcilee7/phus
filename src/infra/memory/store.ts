// src/infra/memory/store.ts
// Project memory — the agent's cross-session notes (phus.md).
//
// Single-file store mirroring the simplest shape of SkillRegistry.
// Sections are delimited by `## ` headings (top-level) and `### `
// headings (nested). `apply()` is the only mutator; every mutation
// returns a unified diff so the TUI permission bar and the tape can
// surface exactly what would change.

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@/infra/logging.js";

/** Maximum bytes we load into the system prompt before truncating. */
export const MEMORY_PROMPT_BUDGET_BYTES = 8 * 1024;
/** Hard ceiling on file size we keep on disk without warning. */
export const MEMORY_FILE_SOFT_LIMIT_BYTES = 64 * 1024;

export type MemoryActionKind = "append" | "replace" | "delete";

export type MemoryAction =
  | { kind: "append"; section: string; body: string }
  | { kind: "replace"; section: string; body: string }
  | { kind: "delete"; section: string };

export type ApplyResult =
  | { ok: true; path: string; diff: string; next: string }
  | { ok: false; reason: string };

/** Parse `## foo` headings into ordered sections. Sections without a
 *  leading heading (preamble / leading prose) live under the empty
 *  string key `""`. */
function splitSections(raw: string): { headings: string[]; bodies: Record<string, string> } {
  const lines = raw.split("\n");
  const headings: string[] = [];
  const bodies: Record<string, string> = { "": "" };

  let current = "";
  for (const line of lines) {
    // Treat only `## ` and `# ` (not `### `) as section boundaries.
    // We promote both — `## ` matches the most common pattern, `# `
    // works for single-level files.
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = line.trim();
      if (!(current in bodies)) {
        headings.push(current);
        bodies[current] = "";
      }
      continue;
    }
    bodies[current] = (bodies[current] ?? "") + line + "\n";
  }
  return { headings, bodies };
}

function serialize(headings: string[], bodies: Record<string, string>): string {
  const out: string[] = [];
  if (bodies[""]) out.push(bodies[""]);
  for (const h of headings) {
    out.push(h + "\n");
    out.push(bodies[h] ?? "");
  }
  return out.join("");
}

function normalizeSection(section: string): string {
  // Accept "Style" / "## Style" / "# Style"; store as the canonical `## heading` form.
  const trimmed = section.trim();
  const m = /^#{1,2}\s+(.+?)\s*$/.exec(trimmed);
  const heading = m ? m[1]! : trimmed;
  return `## ${heading}`;
}

/** Tiny unified diff good enough for PermissionBar preview + tape log. */
function buildDiff(before: string, after: string, action: MemoryAction): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const sectionLabel = normalizeSection(action.kind === "delete" ? action.section : action.section);
  const header = `--- phus.md\n+++ phus.md  (${action.kind} ${sectionLabel})\n`;
  const ctx = beforeLines
    .filter((l) => l.startsWith(sectionLabel))
    .concat(afterLines.filter((l) => l.startsWith(sectionLabel)))
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, 4);
  return header + ctx.map((l) => ` ${l}`).join("\n");
}

export class MemoryStore {
  /** Cached file size — refreshed by `apply()` / `read()`. */
  private _size = 0;

  constructor(public readonly filePath: string) {
    const dir = path.dirname(filePath);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  }

  /** Read the current state. Missing file → empty. */
  read(): { raw: string; sections: Record<string, string> } {
    if (!fs.existsSync(this.filePath)) {
      this._size = 0;
      return { raw: "", sections: {} };
    }
    const raw = fs.readFileSync(this.filePath, "utf-8");
    this._size = Buffer.byteLength(raw, "utf-8");
    const { bodies } = splitSections(raw);
    // Expose only the headings as keys (drop the preamble `""` key).
    const sections: Record<string, string> = {};
    for (const [k, v] of Object.entries(bodies)) {
      if (k) sections[k] = v;
    }
    return { raw, sections };
  }

  /** Approximate byte size of the on-disk file (cached). */
  size(): number {
    if (this._size === 0 && fs.existsSync(this.filePath)) {
      this._size = fs.statSync(this.filePath).size;
    }
    return this._size;
  }

  /** Apply an action. Returns a diff regardless of whether the change
   *  is material, so the caller can log it. */
  apply(action: MemoryAction): ApplyResult {
    const current = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, "utf-8") : "";
    const { headings, bodies } = splitSections(current);
    const heading = normalizeSection(action.section);
    const body = action.kind === "delete" ? "" : action.body;

    switch (action.kind) {
      case "append": {
        if (!(heading in bodies)) {
          headings.push(heading);
          bodies[heading] = "";
        }
        const existing = bodies[heading] ?? "";
        const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
        bodies[heading] = existing + sep + body.trim() + "\n";
        break;
      }
      case "replace": {
        if (!(heading in bodies)) {
          headings.push(heading);
        }
        bodies[heading] = body.trim() + "\n";
        break;
      }
      case "delete": {
        if (!(heading in bodies)) {
          return { ok: false, reason: `section not found: ${heading}` };
        }
        delete bodies[heading];
        const idx = headings.indexOf(heading);
        if (idx >= 0) headings.splice(idx, 1);
        break;
      }
    }

    const next = serialize(headings, bodies);
    const diff = buildDiff(current, next, action);
    try {
      fs.writeFileSync(this.filePath, next, "utf-8");
      this._size = Buffer.byteLength(next, "utf-8");
      if (this._size > MEMORY_FILE_SOFT_LIMIT_BYTES) {
        logger.warn("memory.file_large", {
          path: this.filePath,
          bytes: this._size,
          softLimit: MEMORY_FILE_SOFT_LIMIT_BYTES,
        });
      }
      logger.info("memory.write", {
        path: this.filePath,
        action: action.kind,
        section: heading,
        autonomy: "auto", // overridden by callers (memory-tools) when they decide approve
      });
      return { ok: true, path: this.filePath, diff, next };
    } catch (err) {
      return {
        ok: false,
        reason: `write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Format for system-prompt injection. Truncates aggressively if
   *  the file is large so we don't blow the context window. */
  toPromptContext(): string {
    const { raw } = this.read();
    if (!raw) return "## Project memory\n(no project memory yet)";
    const bytes = Buffer.byteLength(raw, "utf-8");
    if (bytes <= MEMORY_PROMPT_BUDGET_BYTES) {
      return `## Project memory\n${raw}`;
    }
    // Truncate by lines — keep whole lines, not bytes mid-character.
    const kept: string[] = [];
    let used = 0;
    for (const line of raw.split("\n")) {
      const len = Buffer.byteLength(line, "utf-8") + 1;
      if (used + len > MEMORY_PROMPT_BUDGET_BYTES) break;
      kept.push(line);
      used += len;
    }
    const dropped = raw.split("\n").length - kept.length;
    return (
      `## Project memory (truncated — ${dropped} more lines; ` +
      `see phus.md for full content)\n${kept.join("\n")}`
    );
  }
}
