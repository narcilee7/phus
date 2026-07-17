// test/tui/palette-history.test.ts

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadPaletteHistory,
  recordPaletteUse,
  score,
  type PaletteHistoryEntry,
} from "../../src/tui/palette-history.js";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), "phus-history-"));
});

afterEach(() => {
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

describe("palette-history", () => {
  it("returns an empty array when no history exists", async () => {
    const hist = await loadPaletteHistory(homeDir);
    expect(hist).toEqual([]);
  });

  it("records a new entry", async () => {
    await recordPaletteUse(homeDir, "/quit ", "command");
    const hist = await loadPaletteHistory(homeDir);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ value: "/quit ", group: "command", count: 1 });
  });

  it("increments count and updates timestamp on repeated use", async () => {
    await recordPaletteUse(homeDir, "/quit ", "command");
    const first = await loadPaletteHistory(homeDir);
    await new Promise((r) => setTimeout(r, 10));
    await recordPaletteUse(homeDir, "/quit ", "command");
    const second = await loadPaletteHistory(homeDir);
    expect(second).toHaveLength(1);
    expect(second[0].count).toBe(2);
    expect(second[0].ts).toBeGreaterThanOrEqual(first[0].ts);
  });

  it("keeps distinct groups separate", async () => {
    await recordPaletteUse(homeDir, "/quit ", "command");
    await recordPaletteUse(homeDir, "@src/foo.ts ", "file");
    const hist = await loadPaletteHistory(homeDir);
    expect(hist).toHaveLength(2);
  });

  it("score decays with age", () => {
    const nowTs = Date.now();
    const fresh: PaletteHistoryEntry = { value: "a", group: "command", ts: nowTs, count: 1 };
    const stale: PaletteHistoryEntry = { value: "b", group: "command", ts: nowTs - 36e5, count: 1 };
    expect(score(fresh)).toBeGreaterThan(score(stale));
  });

  it("tolerates a missing home directory gracefully", async () => {
    await expect(recordPaletteUse("", "/quit ", "command")).resolves.toBeUndefined();
    await expect(loadPaletteHistory("")).resolves.toEqual([]);
  });

  it("limits the number of retained entries", async () => {
    for (let i = 0; i < 250; i++) {
      await recordPaletteUse(homeDir, `value-${i}`, "command");
    }
    const hist = await loadPaletteHistory(homeDir);
    expect(hist.length).toBeLessThanOrEqual(200);
  });

  it("persists history to a file in PHUS_HOME", async () => {
    await recordPaletteUse(homeDir, "/quit ", "command");
    expect(existsSync(path.join(homeDir, "palette-history.jsonl"))).toBe(true);
  });
});
