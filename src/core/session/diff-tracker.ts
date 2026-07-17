// src/core/session/diff-tracker.ts
// Snapshot + diff for code edits.
//
// `DiffTracker` is the lightweight primitive that lets the verifier and
// the evolution loop see exactly what an edit step changed. The strategy
// is intentionally simple: hash + line-level compare. We don't ship a
// Myers diff implementation — we only need the signal "what changed" for
// audit and for verification prompts, not a full unified-diff rendering.
//
// Usage:
//   const tracker = new DiffTracker();
//   tracker.snapshot(["src/foo.ts", "src/bar.ts"]);
//   // ... agent edits those files ...
//   const summary = tracker.diff(["src/foo.ts", "src/bar.ts"]);
//   // summary.added / .removed / .changedFiles / .changedLineCount

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface DiffSummary {
    /** Files present in after-snapshot that were not in before. */
    added: string[];
    /** Files present in before-snapshot that were removed in after. */
    removed: string[];
    /** Files present in both with content change. */
    changed: string[];
    /** Files present in both with identical content. */
    unchanged: string[];
    /** Approximate number of changed lines across all changed files. */
    changedLineCount: number;
}

export interface DiffOptions {
    /** Max line length stored in the line cache. Default 200. */
    maxLineLength?: number;
    /** Max file size to compare (bytes). Default 1 MiB. */
    maxFileSize?: number;
}

interface FileSnapshot {
    exists: boolean;
    size: number;
    hash: string;
    lines: string[];
}

export class DiffTracker {
    private readonly maxLineLength: number;
    private readonly maxFileSize: number;
    private before: Map<string, FileSnapshot> = new Map();
    private after: Map<string, FileSnapshot> = new Map();
    private tracked: Set<string> = new Set();

    constructor(options: DiffOptions = {}) {
        this.maxLineLength = options.maxLineLength ?? 200;
        this.maxFileSize = options.maxFileSize ?? 1024 * 1024;
    }

    /** Capture the current on-disk state of `paths` as the "before" snapshot. */
    snapshot(paths: Iterable<string>): void {
        this.before.clear();
        this.tracked.clear();
        for (const p of paths) {
            const abs = path.resolve(p);
            this.tracked.add(abs);
            this.before.set(abs, this.capture(abs));
        }
    }

    /** Re-capture the "after" snapshot for the same set of paths. */
    refreshAfter(): void {
        this.after.clear();
        for (const abs of this.tracked) {
            this.after.set(abs, this.capture(abs));
        }
    }

    /** Compute the diff between the before and after snapshots. */
    diff(paths?: Iterable<string>): DiffSummary {
        // If caller passed an explicit list, use it. Otherwise use whatever
        // was originally snapshotted.
        const tracked = paths ? new Set(Array.from(paths, (p) => path.resolve(p))) : this.tracked;

        this.refreshAfter();

        const added: string[] = [];
        const removed: string[] = [];
        const changed: string[] = [];
        const unchanged: string[] = [];
        let changedLineCount = 0;

        for (const abs of tracked) {
            const before = this.before.get(abs);
            const after = this.after.get(abs);

            if (!before?.exists && after?.exists) {
                added.push(abs);
                changedLineCount += after.lines.length;
                continue;
            }
            if (before?.exists && !after?.exists) {
                removed.push(abs);
                changedLineCount += before.lines.length;
                continue;
            }
            if (!before || !after) {
                continue;
            }
            if (before.hash === after.hash) {
                unchanged.push(abs);
                continue;
            }

            const beforeLines = before.lines;
            const afterLines = after.lines;
            const max = Math.max(beforeLines.length, afterLines.length);
            let lineChanges = 0;
            for (let i = 0; i < max; i++) {
                if (beforeLines[i] !== afterLines[i]) lineChanges++;
            }
            changed.push(abs);
            changedLineCount += lineChanges;
        }

        // Sort for deterministic output — easier to test, easier to read in logs.
        added.sort();
        removed.sort();
        changed.sort();
        unchanged.sort();

        return { added, removed, changed, unchanged, changedLineCount };
    }

    /**
     * Render a compact human-readable summary suitable for embedding in
     * verifier prompts or tape entries.
     */
    format(summary: DiffSummary): string {
        if (
            summary.added.length === 0 &&
            summary.removed.length === 0 &&
            summary.changed.length === 0
        ) {
            return "(no file changes)";
        }
        const parts: string[] = [];
        if (summary.added.length > 0) parts.push(`+${summary.added.length} added`);
        if (summary.removed.length > 0) parts.push(`-${summary.removed.length} removed`);
        if (summary.changed.length > 0) parts.push(`~${summary.changed.length} modified`);
        parts.push(`Δ${summary.changedLineCount} lines`);
        return parts.join(" ");
    }

    private capture(abs: string): FileSnapshot {
        try {
            const stat = fs.statSync(abs);
            if (!stat.isFile() || stat.size > this.maxFileSize) {
                return { exists: false, size: 0, hash: "", lines: [] };
            }
            const content = fs.readFileSync(abs, "utf-8");
            return {
                exists: true,
                size: stat.size,
                hash: hash(content),
                lines: splitLines(content, this.maxLineLength),
            };
        } catch {
            return { exists: false, size: 0, hash: "", lines: [] };
        }
    }
}

function hash(text: string): string {
    return crypto.createHash("sha1").update(text, "utf-8").digest("hex");
}

function splitLines(text: string, maxLen: number): string[] {
    return text.split(/\r?\n/).map((l) => (l.length > maxLen ? `${l.slice(0, maxLen)}…` : l));
}