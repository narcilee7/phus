import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RepoFileIndex } from "@phus/core/session/repo-file-index.js";
import { selectRelevantFiles } from "@phus/core/session/context-select.js";

function makeTree(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-repo-index-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/foo.ts"), "export const foo = 1;\n");
    fs.writeFileSync(path.join(dir, "src/bar.tsx"), "export const bar = 2;\n");
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "test/foo.test.ts"), "test('foo', () => {});\n");
    fs.mkdirSync(path.join(dir, "node_modules", "lodash"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "lodash", "index.js"), "// noise\n");
    fs.writeFileSync(path.join(dir, "README.md"), "# Phus\n");
    return dir;
}

describe("RepoFileIndex", () => {
    let root: string;
    beforeEach(() => {
        root = makeTree();
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("walks the tree and skips ignored dirs", () => {
        const index = new RepoFileIndex(root);
        const all = index.all();
        expect(all.map((f) => f.relPath).sort()).toEqual([
            "README.md",
            "src/bar.tsx",
            "src/foo.ts",
            "test/foo.test.ts",
        ]);
    });

    it("marks source files and ignores binary / noisy extensions", () => {
        fs.writeFileSync(path.join(root, "big.png"), Buffer.from([0, 1, 2, 3]));
        fs.writeFileSync(path.join(root, "data.sqlite"), "x");
        const index = new RepoFileIndex(root);
        const all = index.all();
        expect(all.find((f) => f.relPath === "src/foo.ts")?.isSource).toBe(true);
        expect(all.find((f) => f.relPath.endsWith(".png"))).toBeUndefined();
        expect(all.find((f) => f.relPath.endsWith(".sqlite"))).toBeUndefined();
    });

    it("search() ranks files by path-token overlap", () => {
        const index = new RepoFileIndex(root);
        const hits = index.search("foo");
        expect(hits[0]?.file.relPath).toMatch(/foo/);
        // Two paths mention "foo" — both should appear.
        expect(hits.find((h) => h.file.relPath === "src/foo.ts")).toBeDefined();
        expect(hits.find((h) => h.file.relPath === "test/foo.test.ts")).toBeDefined();
    });

    it("search() with empty query returns source files deterministically", () => {
        const index = new RepoFileIndex(root);
        const hits = index.search("");
        expect(hits.length).toBeGreaterThan(0);
        // Should only contain files whose ext is in SOURCE_EXT.
        for (const h of hits) {
            expect(h.file.isSource).toBe(true);
        }
    });

    it("selectRelevantFiles wraps search() with a budget", () => {
        const index = new RepoFileIndex(root);
        const hits = selectRelevantFiles(index, "foo", { budget: 1 });
        expect(hits).toHaveLength(1);
    });
});
