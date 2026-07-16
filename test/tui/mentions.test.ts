// test/tui/mentions.test.ts
// Pure-function tests for @-mention parsing and context-block building.

import { describe, expect, it } from "vitest";
import { extractMentions, buildContextBlock, readFileMention, formatFileSize } from "../../src/tui/mentions.js";

describe("extractMentions", () => {
  it("extracts file mentions with separators", () => {
    const mentions = extractMentions("look at @src/foo.ts and @README.md");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toEqual({ type: "file", raw: "@src/foo.ts", target: "src/foo.ts" });
    expect(mentions[1]).toEqual({ type: "file", raw: "@README.md", target: "README.md" });
  });

  it("extracts skill mentions", () => {
    const mentions = extractMentions("use @skill/commit-message");
    expect(mentions).toEqual([{ type: "skill", raw: "@skill/commit-message", target: "commit-message" }]);
  });

  it("ignores mentions after a space", () => {
    const mentions = extractMentions("email me @ example.com");
    expect(mentions).toHaveLength(0);
  });

  it("returns empty for plain text", () => {
    expect(extractMentions("hello world")).toEqual([]);
  });
});

describe("buildContextBlock", () => {
  it("wraps file contents", () => {
    const block = buildContextBlock([{ path: "a.ts", content: "const x = 1;", size: 12 }]);
    expect(block).toContain("<context>");
    expect(block).toContain("--- file: a.ts ---");
    expect(block).toContain("const x = 1;");
    expect(block).toContain("</context>");
  });

  it("returns empty string when no files", () => {
    expect(buildContextBlock([])).toBe("");
  });
});

describe("readFileMention", () => {
  it("reads an existing file", async () => {
    const ctx = await readFileMention("package.json");
    expect(ctx.path).toBe("package.json");
    expect(ctx.content).toContain("\"name\"");
    expect(ctx.size).toBeGreaterThan(0);
  });

  it("throws for missing files", async () => {
    await expect(readFileMention("does-not-exist-xyz.txt")).rejects.toThrow();
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(512)).toBe("512B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1536)).toBe("1.5kB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024 * 2)).toBe("2.0MB");
  });
});
