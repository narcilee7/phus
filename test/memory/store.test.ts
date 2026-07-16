// test/memory/store.test.ts
// Unit tests for MemoryStore (phus.md read/apply/truncate).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MemoryStore,
  MEMORY_PROMPT_BUDGET_BYTES,
  MEMORY_FILE_SOFT_LIMIT_BYTES,
} from "@/infra/memory/store.js";

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-mem-"));
  filePath = path.join(tmpDir, "phus.md");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MemoryStore.read", () => {
  it("returns empty for a missing file", () => {
    const store = new MemoryStore(filePath);
    const { raw, sections } = store.read();
    expect(raw).toBe("");
    expect(sections).toEqual({});
  });

  it("splits content by ## headings", () => {
    fs.writeFileSync(
      filePath,
      ["# Title", "", "## Style", "", "Use Chinese.", "", "## Tools", "", "- bash", "- file_write", ""].join("\n"),
    );
    const store = new MemoryStore(filePath);
    const { sections } = store.read();
    expect(Object.keys(sections)).toEqual(["## Style", "## Tools"]);
    expect(sections["## Style"]).toContain("Use Chinese.");
    expect(sections["## Tools"]).toContain("- bash");
  });

  it("exposes size() consistent with on-disk bytes", () => {
    fs.writeFileSync(filePath, "## A\n\nbody\n");
    const store = new MemoryStore(filePath);
    store.read();
    expect(store.size()).toBe(fs.statSync(filePath).size);
  });
});

describe("MemoryStore.apply", () => {
  it("creates the file when missing", () => {
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "append", section: "Style", body: "Use Chinese." });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("## Style");
    expect(fs.readFileSync(filePath, "utf-8")).toContain("Use Chinese.");
  });

  it("appends to an existing section without touching others", () => {
    fs.writeFileSync(
      filePath,
      ["## Style", "", "Use Chinese.", "", "## Tools", "", "- bash", ""].join("\n"),
    );
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "append", section: "Style", body: "Use Rust." });
    expect(result.ok).toBe(true);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).toContain("Use Chinese.");
    expect(raw).toContain("Use Rust.");
    expect(raw).toContain("## Tools");
  });

  it("creates the section when appending to a missing heading", () => {
    fs.writeFileSync(filePath, "## Existing\n\nbody\n");
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "append", section: "NewSection", body: "fresh" });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("## NewSection");
  });

  it("replaces a section's body wholesale", () => {
    fs.writeFileSync(
      filePath,
      ["## Style", "", "Old line 1.", "Old line 2.", "", "## Tools", "", "- bash", ""].join("\n"),
    );
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "replace", section: "Style", body: "Only line." });
    expect(result.ok).toBe(true);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).not.toContain("Old line 1.");
    expect(raw).not.toContain("Old line 2.");
    expect(raw).toContain("Only line.");
    expect(raw).toContain("## Tools");
  });

  it("deletes a section by heading", () => {
    fs.writeFileSync(
      filePath,
      ["## A", "", "alpha", "", "## B", "", "beta", ""].join("\n"),
    );
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "delete", section: "A" });
    expect(result.ok).toBe(true);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).not.toContain("## A");
    expect(raw).not.toContain("alpha");
    expect(raw).toContain("## B");
  });

  it("refuses to delete a non-existent section", () => {
    fs.writeFileSync(filePath, "## A\n\nalpha\n");
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "delete", section: "Nope" });
    expect(result.ok).toBe(false);
  });

  it("returns a non-empty diff on success", () => {
    const store = new MemoryStore(filePath);
    const result = store.apply({ kind: "append", section: "X", body: "y" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diff).toContain("## X");
      expect(result.diff).toContain("--- phus.md");
    }
  });

  it("normalises section names (Style / ## Style / # Style)", () => {
    const store = new MemoryStore(filePath);
    store.apply({ kind: "append", section: "Style", body: "from bare" });
    store.apply({ kind: "append", section: "## Tools", body: "from prefixed" });
    const { sections } = store.read();
    expect(sections["## Style"]).toContain("from bare");
    expect(sections["## Tools"]).toContain("from prefixed");
  });
});

describe("MemoryStore.toPromptContext", () => {
  it("reports empty state honestly", () => {
    const store = new MemoryStore(filePath);
    expect(store.toPromptContext()).toContain("(no project memory yet)");
  });

  it("renders short files verbatim", () => {
    fs.writeFileSync(filePath, "## Style\n\nUse Chinese.\n");
    const store = new MemoryStore(filePath);
    const ctx = store.toPromptContext();
    expect(ctx).toContain("## Project memory");
    expect(ctx).toContain("Use Chinese.");
  });

  it("truncates oversized files and notes the drop", () => {
    const bigLine = "x".repeat(200);
    const lines = Array.from({ length: 200 }, (_, i) => `${i}: ${bigLine}`).join("\n");
    fs.writeFileSync(filePath, lines + "\n");
    expect(Buffer.byteLength(lines, "utf-8")).toBeGreaterThan(MEMORY_PROMPT_BUDGET_BYTES);

    const store = new MemoryStore(filePath);
    const ctx = store.toPromptContext();
    expect(ctx.length).toBeLessThan(lines.length);
    expect(ctx).toMatch(/truncated/i);
  });
});

describe("MemoryStore size warnings", () => {
  it("soft limit is exported and finite", () => {
    expect(MEMORY_FILE_SOFT_LIMIT_BYTES).toBeGreaterThan(0);
    expect(MEMORY_PROMPT_BUDGET_BYTES).toBeLessThan(MEMORY_FILE_SOFT_LIMIT_BYTES);
  });
});
