// test/memory-os.test.ts
// §A Memory OS: category + authority metadata, compact(), tape provenance.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, inferCategory } from "@/infra/memory/store";
import type { TapeEntry } from "@/types/tape/index";
import type { TapeLike } from "@/types/hooks/index";

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-mem-os-"));
    filePath = path.join(tmpDir, "phus.md");
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MemoryStore category + authority", () => {
    it("round-trips category and authority via the heading-line comment", () => {
        const store = new MemoryStore(filePath);
        const r = store.apply({
            kind: "append",
            section: "Style",
            body: "Use Chinese.",
            category: "preferences",
            authority: "user",
        });
        expect(r.ok).toBe(true);

        const onDisk = fs.readFileSync(filePath, "utf-8");
        expect(onDisk).toContain("category: preferences");
        expect(onDisk).toContain("authority: user");

        const { sections, raw } = store.read();
        expect(raw).toContain("category: preferences");
        expect(sections["## Style"]).toContain("Use Chinese.");
    });

    it("infers category from heading when none is provided", () => {
        const store = new MemoryStore(filePath);
        store.apply({ kind: "append", section: "Coding Style", body: "tabs > spaces" });
        store.apply({ kind: "append", section: "Tools Used", body: "pnpm, vitest" });
        store.apply({ kind: "append", section: "Recipes", body: "1. read file" });
        store.apply({ kind: "append", section: "Random", body: "x" });

        expect(inferCategory("Coding Style")).toBe("preferences");
        expect(inferCategory("Tools Used")).toBe("tools");
        expect(inferCategory("Recipes")).toBe("procedures");
        expect(inferCategory("Random")).toBe("notes");
    });

    it("toPromptContext includes both sections and preserves authority metadata through round-trip", () => {
        const store = new MemoryStore(filePath);
        // Two sections that both match the query "tools" by body content.
        // Their ranking within the selection differs by authority, but the
        // rendered block keeps file order so both appear regardless.
        store.apply({
            kind: "append",
            section: "Tools A",
            body: "we use tools here for daily work",
            category: "tools",
            authority: "agent",
        });
        store.apply({
            kind: "append",
            section: "Tools B",
            body: "we use tools here for special work",
            category: "tools",
            authority: "user",
        });

        const ctx = store.toPromptContext("tools");
        expect(ctx).toContain("Tools A");
        expect(ctx).toContain("Tools B");

        // And the user/agent authorities survive the file round-trip.
        const { sections } = store.read();
        expect(sections["## Tools A"]).toContain("daily work");
        expect(sections["## Tools B"]).toContain("special work");
        const onDisk = fs.readFileSync(filePath, "utf-8");
        expect(onDisk).toContain("authority: user");
        expect(onDisk).toContain("authority: agent");
    });

    it("falls back to defaults when legacy phus.md has no inline metadata", () => {
        // Simulate a phus.md written before §A landed.
        fs.writeFileSync(filePath, ["## Legacy", "", "Some old notes.", ""].join("\n"));

        const store = new MemoryStore(filePath);
        const ctx = store.toPromptContext("notes");
        expect(ctx).toContain("## Legacy");
        // Round-trip should preserve the section but add no comment (defaults).
        store.apply({ kind: "append", section: "Legacy", body: "added later" });
        const { raw } = store.read();
        // The Legacy heading stays as-is (default meta is not emitted).
        expect(raw).toMatch(/^## Legacy/m);
    });
});

describe("MemoryStore.compact", () => {
    it("is a no-op when sections are below the keepLast threshold", () => {
        const store = new MemoryStore(filePath);
        store.apply({ kind: "append", section: "Notes", body: "a\nb\nc" });
        const before = store.size();
        const result = store.compact({ keepLast: 5 });
        expect(result.removedBytes).toBe(0);
        expect(result.touchedSections).toEqual([]);
        expect(store.size()).toBe(before);
    });

    it("keeps the last N entries and condenses older ones into a summary", () => {
        const store = new MemoryStore(filePath);
        // Use verbose entries so compact actually trims bytes — small
        // bullets cost more in summary-section overhead than they save.
        const bullets = Array.from({ length: 50 }, (_, i) =>
            `- entry number ${i} with enough padding text to make the line meaningful`,
        ).join("\n");
        store.apply({ kind: "append", section: "Log", body: bullets, category: "notes", authority: "agent" });

        const beforeBytes = store.size();
        const result = store.compact({ keepLast: 5 });
        expect(result.touchedSections).toEqual(["## Log"]);
        expect(result.removedBytes).toBeGreaterThan(0);
        expect(store.size()).toBeLessThan(beforeBytes);

        const { sections } = store.read();
        const logBody = sections["## Log"] ?? "";
        // Last 5 entries survive.
        expect(logBody).toContain("entry number 49");
        expect(logBody).toContain("entry number 48");
        expect(logBody).toContain("entry number 45");
        // Older entries are summarized — entry 0 (the very first) should
        // be referenced via "(older)" prefix in the digest.
        expect(logBody).toContain("compacted");

        // A _summary sibling section is created so retrieval can still hit
        // the older digest via the heading index.
        const summaryKey = Object.keys(sections).find((k) => k.includes("Log") && k.includes("summary"));
        expect(summaryKey).toBeDefined();
        expect(sections[summaryKey!]).toContain("compacted");
    });

    it("preserves user/system authority through compact", () => {
        const store = new MemoryStore(filePath);
        const bullets = Array.from({ length: 8 }, (_, i) => `- u${i}`).join("\n");
        store.apply({ kind: "append", section: "Prefs", body: bullets, authority: "user", category: "preferences" });
        store.compact({ keepLast: 2 });
        const { raw } = store.read();
        // The user authority should round-trip on the rebuilt section.
        expect(raw).toMatch(/## Prefs\s*<!--[^>]*authority: user/);
    });
});

describe("memory_write tape provenance", () => {
    it("passes category + authority into the tape entry", async () => {
        // Reuse the meta tool factory; verify the tape payload.
        const { defineMemoryMetaTools, parseMemoryAction } = await import("@/infra/meta/memory-tools.js");
        expect(parseMemoryAction).toBeDefined();

        const store = new MemoryStore(filePath);
        const tapeEntries: TapeEntry[] = [];
        const tape: TapeLike = {
            append: (e: TapeEntry) => tapeEntries.push(e),
            replay: function* () { for (const e of tapeEntries) yield e; },
            summary: () => "",
            stats: () => ({ totalEntries: tapeEntries.length, sessions: {} }),
            loadAnchor: () => undefined,
        };

        const tools = defineMemoryMetaTools({ store, tape });
        const write = tools.find((t) => t.name === "memory_write");
        expect(write).toBeDefined();

        await write!.execute({
            action: {
                kind: "append",
                section: "Style",
                body: "Use English.",
                category: "preferences",
                authority: "user",
            },
            reason: "user asked",
        });

        expect(tapeEntries).toHaveLength(1);
        const entry = tapeEntries[0] as TapeEntry & { category?: string; authority?: string };
        if (entry.kind === "memory_write") {
            expect(entry.category).toBe("preferences");
            expect(entry.authority).toBe("user");
        } else {
            throw new Error("expected memory_write tape entry");
        }
    });

    it("parseMemoryAction rejects unknown category", async () => {
        const { parseMemoryAction } = await import("@/infra/meta/memory-tools.js");
        expect(() =>
            parseMemoryAction({
                kind: "append",
                section: "Style",
                body: "x",
                category: "unknown-category",
            }),
        ).toThrow(/invalid category/);
    });
});