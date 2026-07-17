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

interface MemorySection {
  heading: string;
  body: string;
  index: number;
}

interface ScoredMemorySection extends MemorySection {
  score: number;
  queryCoverage: number;
  sectionCoverage: number;
  headingOverlap: number;
  recency: number;
}

const MEMORY_PROMPT_SECTION_BUDGET = 4;
const MEMORY_PROMPT_MIN_SCORE = 0.18;
const MEMORY_PROMPT_RECENCY_WEIGHT = 0.1;

/** Parse `## foo` headings into ordered sections. Sections without a
 *  leading heading (preamble / leading prose) live under the empty
 *  string key `""`. */
function splitSections(raw: string): { headings: string[]; bodies: Record<string, string> } {
  const lines = raw.split("\n");
  const headings: string[] = [];
  const bodies: Record<string, string> = { "": "" };

  let current = "";
  for (const line of lines) {
    // Treat `## ` (and deeper) as section boundaries. `# ` is reserved
    // for the document title — it's not a section, it goes into the
    // preamble under the empty key.
    const m = /^(#{2,})\s+(.+?)\s*$/.exec(line);
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

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count++;
  }
  return count;
}

function shortenQuery(query: string, max = 80): string {
  const compact = query.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

function collectSections(raw: string): MemorySection[] {
  const { headings, bodies } = splitSections(raw);
  return headings.map((heading, index) => ({
    heading,
    body: bodies[heading] ?? "",
    index,
  }));
}

function formatSection(section: MemorySection): string {
  const body = section.body.trimEnd();
  if (!body) return section.heading;
  return `${section.heading}\n\n${body}`;
}

function limitPromptContext(context: string): string {
  const bytes = Buffer.byteLength(context, "utf-8");
  if (bytes <= MEMORY_PROMPT_BUDGET_BYTES) return context;

  const lines = context.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const len = Buffer.byteLength(line, "utf-8") + 1;
    if (used + len > MEMORY_PROMPT_BUDGET_BYTES) break;
    kept.push(line);
    used += len;
  }

  if (kept.length === 0) {
    return context.slice(0, MEMORY_PROMPT_BUDGET_BYTES);
  }

  const dropped = Math.max(0, lines.length - kept.length);
  const [firstLine, ...rest] = kept;
  return [
    `${firstLine} (truncated — ${dropped} more lines; see phus.md for full content)`,
    ...rest,
  ].join("\n");
}

function renderFullPromptContext(raw: string): string {
  return limitPromptContext(`## Project memory\n${raw}`);
}

function scoreSection(section: MemorySection, queryTokens: Set<string>, total: number): ScoredMemorySection {
  const sectionTokens = tokenize(`${section.heading} ${section.body}`);
  const headingTokens = tokenize(section.heading);
  const overlap = overlapCount(queryTokens, sectionTokens);
  const headingOverlap = overlapCount(queryTokens, headingTokens);
  const queryCoverage = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
  const sectionCoverage = sectionTokens.size > 0 ? overlap / sectionTokens.size : 0;
  const recency = total > 1 ? section.index / (total - 1) : 1;
  const score =
    queryCoverage +
    (sectionCoverage * 0.15) +
    (headingOverlap > 0 ? 0.35 : 0) +
    (recency * MEMORY_PROMPT_RECENCY_WEIGHT);

  return {
    ...section,
    score,
    queryCoverage,
    sectionCoverage,
    headingOverlap,
    recency,
  };
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
  // Accept "Style" / "## Style" / "### Style"; store as the canonical `## heading` form.
  // A bare `# ` is a document title and never a section — we never write it.
  const trimmed = section.trim();
  const m = /^#{2,}\s+(.+?)\s*$/.exec(trimmed);
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
  toPromptContext(query?: string): string {
    const { raw } = this.read();
    if (!raw) return "## Project memory\n(no project memory yet)";
    const trimmedQuery = query?.trim() ?? "";
    if (!trimmedQuery) {
      return renderFullPromptContext(raw);
    }

    const sections = collectSections(raw);
    if (sections.length === 0) {
      return renderFullPromptContext(raw);
    }

    const queryTokens = tokenize(trimmedQuery);
    if (queryTokens.size === 0) {
      return renderFullPromptContext(raw);
    }

    const scored = sections.map((section) => scoreSection(section, queryTokens, sections.length));
    const strongMatches = scored
      .filter((section) => section.score >= MEMORY_PROMPT_MIN_SCORE)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.recency !== a.recency) return b.recency - a.recency;
        return a.index - b.index;
      });

    const selected = (strongMatches.length > 0 ? strongMatches : [...scored].sort((a, b) => {
      if (b.recency !== a.recency) return b.recency - a.recency;
      return a.index - b.index;
    }))
      .slice(0, MEMORY_PROMPT_SECTION_BUDGET)
      .sort((a, b) => a.index - b.index);

    if (selected.length === 0) {
      return renderFullPromptContext(raw);
    }

    const queryLabel = JSON.stringify(shortenQuery(trimmedQuery));
    const selectionLabel = strongMatches.length > 0
      ? `selected for ${queryLabel}; ${selected.length} of ${sections.length} sections`
      : `recent sections for ${queryLabel}; no strong match found`;

    const context = [
      `## Project memory (${selectionLabel})`,
      ...selected.map((section) => formatSection(section)),
    ].join("\n\n");

    return limitPromptContext(context);
  }
}
