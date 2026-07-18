import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DiffTracker } from "@/core/session/diff-tracker.js";

describe("DiffTracker", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-diff-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("detects added files", () => {
        const a = path.join(dir, "a.ts");
        const b = path.join(dir, "b.ts");
        fs.writeFileSync(a, "export const a = 1;\n");
        // Snapshot the workspace path list before any work; b doesn't exist yet.
        const tracker = new DiffTracker();
        tracker.snapshot([a, b]);

        // Agent creates b during the step.
        fs.writeFileSync(b, "export const b = 2;\n");

        const summary = tracker.diff();

        expect(summary.added).toEqual([b]);
        expect(summary.removed).toEqual([]);
        expect(summary.changed).toEqual([]);
    });

    it("detects removed files", () => {
        const a = path.join(dir, "a.ts");
        const b = path.join(dir, "b.ts");
        fs.writeFileSync(a, "a");
        fs.writeFileSync(b, "b");
        const tracker = new DiffTracker();
        tracker.snapshot([a, b]);

        fs.rmSync(b);
        const summary = tracker.diff([a, b]);

        expect(summary.removed).toEqual([b]);
        expect(summary.added).toEqual([]);
    });

    it("detects changed files and counts changed lines", () => {
        const a = path.join(dir, "a.ts");
        fs.writeFileSync(a, ["line1", "line2", "line3", "line4"].join("\n"));
        const tracker = new DiffTracker();
        tracker.snapshot([a]);

        fs.writeFileSync(a, ["line1", "line2-CHANGED", "line3", "line4"].join("\n"));
        const summary = tracker.diff([a]);

        expect(summary.changed).toEqual([a]);
        expect(summary.changedLineCount).toBe(1);
    });

    it("reports unchanged when content hash matches", () => {
        const a = path.join(dir, "a.ts");
        fs.writeFileSync(a, "same");
        const tracker = new DiffTracker();
        tracker.snapshot([a]);

        // Touch the file but keep content the same — common when editors re-save.
        const stat = fs.statSync(a);
        fs.utimesSync(a, stat.atime, stat.mtime);
        const summary = tracker.diff([a]);

        expect(summary.unchanged).toEqual([a]);
        expect(summary.changed).toEqual([]);
    });

    it("format() summarizes counts", () => {
        const tracker = new DiffTracker();
        const summary = tracker.format({
            added: ["/x"],
            removed: [],
            changed: ["/y", "/z"],
            unchanged: ["/w"],
            changedLineCount: 12,
        });
        expect(summary).toContain("+1 added");
        expect(summary).toContain("~2 modified");
        expect(summary).toContain("Δ12 lines");
    });

    it("format() returns the no-op marker when nothing changed", () => {
        const tracker = new DiffTracker();
        const summary = tracker.format({
            added: [],
            removed: [],
            changed: [],
            unchanged: [],
            changedLineCount: 0,
        });
        expect(summary).toBe("(no file changes)");
    });
});
