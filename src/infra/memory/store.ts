// src/infra/memory/store.ts
// Project memory — the agent's cross-session notes (phus.md).
//
// Single-file store mirroring the simplest shape of SkillRegistry.
// Sections are delimited by `## ` headings (top-level) and `### `
// headings (nested). `apply()` is the only mutator; every mutation
// returns a unified diff so the TUI permission bar and the tape can
// surface exactly what would change.
//
// Per-section metadata (category + authority + ts) is encoded as a
// trailing HTML comment on the heading line:
//   `## Style <!-- category: preferences; authority: user; ts: 1700000000000 -->`
// The store stays backwards-compatible — files written before the
// metadata field land parse cleanly with inferred defaults.

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@/infra/logging.js";

/** Maximum bytes we load into the system prompt before truncating. */
export const MEMORY_PROMPT_BUDGET_BYTES = 8 * 1024;
/** Hard ceiling on file size we keep on disk without warning. */
export const MEMORY_FILE_SOFT_LIMIT_BYTES = 64 * 1024;

export type MemoryActionKind = "append" | "replace" | "delete";

/** Canonical §A categories. Free-form section names still work; this is
 *  the suggested vocabulary so retrieval ranking can favor relevant
 *  categories for a query. */
export type MemoryCategory =
    | "facts"
    | "preferences"
    | "decisions"
    | "failures"
    | "procedures"
    | "tools"
    | "style"
    | "notes";

export const MEMORY_CATEGORIES: ReadonlyArray<MemoryCategory> = [
    "facts",
    "preferences",
    "decisions",
    "failures",
    "procedures",
    "tools",
    "style",
    "notes",
];

/** Who/what asserted a section. Used for retrieval ranking — entries
 *  asserted by the user or system outrank agent-self observations,
 *  which outrank tape-derived inferences. */
export type MemoryAuthority = "user" | "system" | "agent" | "tape";

export const MEMORY_AUTHORITIES: ReadonlyArray<MemoryAuthority> = [
    "user",
    "system",
    "agent",
    "tape",
];

/** Authority ordering for ranking. Higher = more authoritative. */
export const MEMORY_AUTHORITY_WEIGHT: Record<MemoryAuthority, number> = {
    user: 1.0,
    system: 0.8,
    agent: 0.5,
    tape: 0.3,
};

export type MemoryAction =
  | { kind: "append"; section: string; body: string; category?: MemoryCategory; authority?: MemoryAuthority }
  | { kind: "replace"; section: string; body: string; category?: MemoryCategory; authority?: MemoryAuthority }
  | { kind: "delete"; section: string };

export type ApplyResult =
  | { ok: true; path: string; diff: string; next: string }
  | { ok: false; reason: string };

interface MemorySectionMeta {
    category: MemoryCategory;
    authority: MemoryAuthority;
    ts: number;
}

interface MemorySection extends MemorySectionMeta {
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

/** Default metadata applied when a section has no inline metadata comment. */
const DEFAULT_META: MemorySectionMeta = {
    category: "notes",
    authority: "agent",
    ts: 0,
};

/** Parse the trailing `<!-- category: ...; authority: ...; ts: ... -->` comment
 *  on a heading line. Returns defaults when the comment is absent. */
function parseMeta(comment: string | undefined): MemorySectionMeta {
    if (!comment) return { ...DEFAULT_META };
    const out: MemorySectionMeta = { ...DEFAULT_META };
    const catMatch = /category:\s*([a-z]+)/i.exec(comment);
    if (catMatch && catMatch[1] && (MEMORY_CATEGORIES as readonly string[]).includes(catMatch[1])) {
        out.category = catMatch[1] as MemoryCategory;
    }
    const authMatch = /authority:\s*([a-z]+)/i.exec(comment);
    if (authMatch && authMatch[1] && (MEMORY_AUTHORITIES as readonly string[]).includes(authMatch[1])) {
        out.authority = authMatch[1] as MemoryAuthority;
    }
    const tsMatch = /ts:\s*(\d+)/i.exec(comment);
    if (tsMatch && tsMatch[1]) {
        const n = Number(tsMatch[1]);
        if (Number.isFinite(n) && n > 0) out.ts = n;
    }
    return out;
}

/** Render metadata as a trailing HTML comment on a heading line. When the
 *  metadata equals defaults, returns the bare heading — keeps the file
 *  clean for sections that never opted in. */
function formatHeading(heading: string, meta: MemorySectionMeta): string {
    const isDefault =
        meta.category === DEFAULT_META.category &&
        meta.authority === DEFAULT_META.authority &&
        meta.ts === DEFAULT_META.ts;
    if (isDefault) return heading;
    return `${heading} <!-- category: ${meta.category}; authority: ${meta.authority}; ts: ${meta.ts} -->`;
}

/** Split a heading line into the bare heading and the trailing meta comment. */
function splitHeading(raw: string): { heading: string; meta: MemorySectionMeta } {
    const m = /^(#{2,}\s+.+?)\s*<!--\s*(.*?)\s*-->\s*$/.exec(raw.trim());
    if (!m) {
        return { heading: raw.trim(), meta: { ...DEFAULT_META } };
    }
    return { heading: m[1]!.trim(), meta: parseMeta(m[2]) };
}

/** Parse `## foo` headings into ordered sections. Sections without a
 *  leading heading (preamble / leading prose) live under the empty
 *  string key `""`. Metadata parsed from heading-line comments is kept
 *  separately so it can survive the round-trip back to disk. */
function splitSections(raw: string): {
    headings: string[];
    bodies: Record<string, string>;
    meta: Record<string, MemorySectionMeta>;
} {
    const lines = raw.split("\n");
    const headings: string[] = [];
    const bodies: Record<string, string> = { "": "" };
    const meta: Record<string, MemorySectionMeta> = {};

    let current = "";
    for (const line of lines) {
        // Treat `## ` (and deeper) as section boundaries. `# ` is reserved
        // for the document title — it's not a section, it goes into the
        // preamble under the empty key.
        const m = /^(#{2,})\s+(.+?)\s*$/.exec(line);
        if (m) {
            const { heading, meta: sectionMeta } = splitHeading(line);
            current = heading;
            if (!(current in bodies)) {
                headings.push(current);
                bodies[current] = "";
            }
            meta[current] = sectionMeta;
            continue;
        }
        bodies[current] = (bodies[current] ?? "") + line + "\n";
    }
    return { headings, bodies, meta };
}

/** Infer a category from a free-form section heading. Best-effort; falls
 *  back to "notes". Used when a writer doesn't supply an explicit
 *  category — keeps retrieval useful even for legacy phus.md files. */
export function inferCategory(heading: string): MemoryCategory {
    const normalized = heading.toLowerCase();
    if (/(style|prefer|tone|voice|language)/.test(normalized)) return "preferences";
    if (/(tool|command|cli)/.test(normalized)) return "tools";
    if (/(fact|context|background)/.test(normalized)) return "facts";
    if (/(decision|choice|trade-?off|architecture)/.test(normalized)) return "decisions";
    if (/(failure|error|gotcha|pitfall|bug)/.test(normalized)) return "failures";
    if (/(procedur|recipe|playbook|workflow|step)/.test(normalized)) return "procedures";
    return "notes";
}

/** Split a section body into "entries" — bullet points, ordered list
 *  items, or blank-line-separated paragraphs. Used by `compact()`. */
function splitEntries(body: string): string[] {
    const trimmed = body.trim();
    if (!trimmed) return [];
    // Try bullet/numbered first; fall back to paragraph split.
    const bullets = trimmed.split(/\n(?=[-*]\s|\d+\.\s)/).map((s) => s.trim()).filter(Boolean);
    if (bullets.length > 1) return bullets;
    const paragraphs = trimmed.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (paragraphs.length > 1) return paragraphs;
    return [trimmed];
}

/** Reduce a list of older entries to a compact digest. We keep the
 *  category-distinct first lines so retrieval can still hit them, then
 *  add a single line summarizing the count and total length. */
function summarizeDropped(dropped: string[]): string[] {
    const distinct: string[] = [];
    const seen = new Set<string>();
    for (const entry of dropped) {
        const firstLine = entry.split("\n")[0]?.trim() ?? "";
        const key = firstLine.slice(0, 80);
        if (key && !seen.has(key)) {
            seen.add(key);
            distinct.push(`- (older) ${firstLine}`);
        }
    }
    if (distinct.length === 0) return ["- (older entries compacted)"];
    return distinct.slice(0, 8);
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
  const { headings, bodies, meta } = splitSections(raw);
  return headings.map((heading, index) => {
    const sectionMeta = meta[heading] ?? { ...DEFAULT_META };
    return {
      heading,
      body: bodies[heading] ?? "",
      index,
      ...sectionMeta,
    };
  });
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
  const authorityWeight = MEMORY_AUTHORITY_WEIGHT[section.authority];
  const score =
    queryCoverage +
    (sectionCoverage * 0.15) +
    (headingOverlap > 0 ? 0.35 : 0) +
    (recency * MEMORY_PROMPT_RECENCY_WEIGHT) +
    (authorityWeight * 0.1);

  return {
    ...section,
    score,
    queryCoverage,
    sectionCoverage,
    headingOverlap,
    recency,
  };
}

function serialize(
  headings: string[],
  bodies: Record<string, string>,
  meta: Record<string, MemorySectionMeta>,
): string {
  const out: string[] = [];
  if (bodies[""]) out.push(bodies[""]);
  for (const h of headings) {
    const heading = formatHeading(h, meta[h] ?? DEFAULT_META);
    out.push(heading + "\n");
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
    const { headings, bodies, meta } = splitSections(current);
    const heading = normalizeSection(action.section);
    const body = action.kind === "delete" ? "" : action.body;

    // Merge metadata for append/replace. Delete doesn't need it.
    if (action.kind === "append" || action.kind === "replace") {
        meta[heading] = {
            category: action.category ?? meta[heading]?.category ?? inferCategory(heading),
            authority: action.authority ?? meta[heading]?.authority ?? DEFAULT_META.authority,
            ts: Date.now(),
        };
    }

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
        delete meta[heading];
        const idx = headings.indexOf(heading);
        if (idx >= 0) headings.splice(idx, 1);
        break;
      }
    }

    const next = serialize(headings, bodies, meta);
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

  /**
   * Compact memory by collapsing older entries inside each section into
   * a `_summary` sub-section. The strategy keeps the last `keepLast`
   * bullet points / paragraphs verbatim and condenses everything older
   * into a single summary block. Returns the number of bytes removed.
   *
   * Useful when phus.md has grown past MEMORY_FILE_SOFT_LIMIT_BYTES —
   * without compaction, `toPromptContext` falls back to byte truncation,
   * which is less useful than a real summary.
   */
  compact(opts: { keepLast?: number; summaryLabel?: string } = {}): { removedBytes: number; touchedSections: string[] } {
    const keepLast = opts.keepLast ?? 5;
    const summaryLabel = opts.summaryLabel ?? "_summary (compacted)";
    const { headings, bodies, meta } = splitSections(this.read().raw);

    const touchedSections: string[] = [];
    const updatedBodies: Record<string, string> = { ...bodies };
    const updatedMeta: Record<string, MemorySectionMeta> = { ...meta };
    const updatedHeadings: string[] = [...headings];
    let removedBytes = 0;

    for (const heading of headings) {
        const body = bodies[heading] ?? "";
        const entries = splitEntries(body);
        if (entries.length <= keepLast) continue;

        const kept = entries.slice(-keepLast);
        const dropped = entries.slice(0, entries.length - keepLast);
        const summary = [
            `- (${dropped.length} older entries compacted at ${new Date().toISOString()})`,
            ...summarizeDropped(dropped),
        ].join("\n");

        const rebuiltBody = `${summary}\n\n${kept.join("\n\n")}\n`;
        removedBytes += body.length - rebuiltBody.length;
        updatedBodies[heading] = rebuiltBody;

        // Pin a summary sub-section immediately after the heading so
        // retrieval still finds the digest even if the older content
        // is dropped from disk.
        const summaryHeading = `${heading} ${summaryLabel}`;
        if (!(summaryHeading in updatedBodies)) {
            updatedHeadings.push(summaryHeading);
            updatedBodies[summaryHeading] = summary;
            updatedMeta[summaryHeading] = {
                category: meta[heading]?.category ?? "notes",
                authority: "agent",
                ts: Date.now(),
            };
        }

        touchedSections.push(heading);
    }

    if (removedBytes === 0 && touchedSections.length === 0) {
        return { removedBytes: 0, touchedSections: [] };
    }

    const next = serialize(updatedHeadings, updatedBodies, updatedMeta);
    try {
        const beforeBytes = this.size();
        fs.writeFileSync(this.filePath, next, "utf-8");
        this._size = Buffer.byteLength(next, "utf-8");
        const netRemoved = beforeBytes - this._size;
        logger.info("memory.compacted", {
            path: this.filePath,
            touchedSections,
            beforeBytes,
            afterBytes: this._size,
            netRemovedBytes: netRemoved,
        });
        return { removedBytes: netRemoved, touchedSections };
    } catch (err) {
        logger.warn("memory.compact_failed", {
            path: this.filePath,
            error: err instanceof Error ? err.message : String(err),
        });
        return { removedBytes: 0, touchedSections: [] };
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
