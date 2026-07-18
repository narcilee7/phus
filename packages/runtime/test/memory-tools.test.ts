// test/meta/memory-tools.test.ts
// Unit tests for memory_read / memory_write meta tools.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineMemoryMetaTools,
  parseMemoryAction,
} from "@/infra/meta/memory-tools";
import { MemoryStore } from "@/infra/memory/store";
import { asSessionId } from "@/types/brand";
import type { Tape } from "@/core/session/tape";
import type { TapeEntry } from "@/types/tape/index";

let tmpDir: string;
let filePath: string;
let store: MemoryStore;
let tapeEntries: TapeEntry[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-mem-tool-"));
  filePath = path.join(tmpDir, "phus.md");
  store = new MemoryStore(filePath);
  tapeEntries = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTape(): Tape {
  const tape = {
    append: (entry: TapeEntry) => { tapeEntries.push(entry); },
    replay: () => (function* () {})(),
    stats: () => ({ totalEntries: tapeEntries.length, sessions: {} }),
  } as unknown as Tape;
  return tape;
}

describe("parseMemoryAction", () => {
  it("accepts bare append and rejects missing body", () => {
    expect(parseMemoryAction({ kind: "append", section: "Style", body: "Use Rust." })).toEqual({
      kind: "append",
      section: "Style",
      body: "Use Rust.",
    });
    expect(() => parseMemoryAction({ kind: "append", section: "Style" })).toThrow();
  });

  it("rejects unknown kinds", () => {
    expect(() => parseMemoryAction({ kind: "nuke", section: "X", body: "y" })).toThrow(/unknown/);
  });

  it("requires a section", () => {
    expect(() => parseMemoryAction({ kind: "delete", section: "" })).toThrow();
    expect(() => parseMemoryAction({ kind: "delete", section: "   " })).toThrow();
  });

  it("delete only needs a section", () => {
    expect(parseMemoryAction({ kind: "delete", section: "Style" })).toEqual({
      kind: "delete",
      section: "Style",
    });
  });
});

describe("memory_read", () => {
  it("returns full raw content when no section given", async () => {
    fs.writeFileSync(filePath, "## Style\n\nUse Chinese.\n");
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const read = tools.find((t) => t.name === "memory_read")!;
    const result = (await read.execute({})) as {
      ok: boolean;
      raw: string;
      sections: Record<string, string>;
    };
    expect(result.ok).toBe(true);
    expect(result.raw).toContain("Use Chinese.");
    expect(result.sections["## Style"]).toContain("Use Chinese.");
  });

  it("returns one section when given", async () => {
    fs.writeFileSync(filePath, ["## A", "", "alpha", "", "## B", "", "beta", ""].join("\n"));
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const read = tools.find((t) => t.name === "memory_read")!;
    const result = (await read.execute({ section: "A" })) as { ok: boolean; body?: string };
    expect(result.ok).toBe(true);
    expect(result.body).toContain("alpha");
  });

  it("returns section_not_found when missing", async () => {
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const read = tools.find((t) => t.name === "memory_read")!;
    const result = (await read.execute({ section: "Ghost" })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("section_not_found");
  });
});

describe("memory_write", () => {
  it("applies the action and writes a memory_write tape entry", async () => {
    const tools = defineMemoryMetaTools({
      store,
      tape: makeTape(),
      getCurrentSessionId: () => asSessionId("test-session"),
    });
    const write = tools.find((t) => t.name === "memory_write")!;
    const result = (await write.execute({
      action: { kind: "append", section: "Style", body: "Use Rust." },
      reason: "user prefers Rust",
    })) as { ok: boolean; path: string; action: { kind: string; section: string }; diff: string };

    expect(result.ok).toBe(true);
    expect(result.path).toBe(filePath);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("Use Rust.");

    expect(tapeEntries).toHaveLength(1);
    const entry = tapeEntries[0]!;
    expect(entry.kind).toBe("memory_write");
    if (entry.kind === "memory_write") {
      expect(entry.sessionId).toBe("test-session");
      expect(entry.action.kind).toBe("append");
      expect(entry.action.section).toBe("Style");
      expect(entry.reason).toBe("user prefers Rust");
      expect(entry.diff).toContain("## Style");
      expect(entry.autonomyDecision).toBe("auto");
    }
  });

  it("falls back to session 'default' when no session id supplied", async () => {
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const write = tools.find((t) => t.name === "memory_write")!;
    await write.execute({
      action: { kind: "append", section: "X", body: "y" },
      reason: "r",
    });
    expect(tapeEntries[0]!.kind).toBe("memory_write");
  });

  it("falls back to '(no reason given)' when reason is missing", async () => {
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const write = tools.find((t) => t.name === "memory_write")!;
    await write.execute({
      action: { kind: "append", section: "X", body: "y" },
    });
    const entry = tapeEntries[0]!;
    if (entry.kind === "memory_write") {
      expect(entry.reason).toBe("(no reason given)");
    }
  });

  it("continues when tape.append fails (memory store still succeeded)", async () => {
    const brokenTape = {
      append: () => { throw new Error("tape down"); },
      replay: () => (function* () {})(),
      stats: () => ({ totalEntries: 0, sessions: {} }),
    } as unknown as Tape;
    const tools = defineMemoryMetaTools({ store, tape: brokenTape });
    const write = tools.find((t) => t.name === "memory_write")!;
    const result = (await write.execute({
      action: { kind: "append", section: "X", body: "y" },
      reason: "r",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toContain("y");
  });

  it("throws when store.apply fails (delete missing section)", async () => {
    const tools = defineMemoryMetaTools({ store, tape: makeTape() });
    const write = tools.find((t) => t.name === "memory_write")!;
    await expect(
      write.execute({
        action: { kind: "delete", section: "Ghost" },
        reason: "r",
      }),
    ).rejects.toThrow(/section not found/);
    expect(tapeEntries).toHaveLength(0);
  });
});
