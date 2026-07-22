// test/compact-events.test.ts
import { describe, expect, it } from "vitest";
import { compactEventToAction } from "../src/transform/compact-events.js";

describe("compactEventToAction", () => {
  it("context_near_limit → warn with percentage and tokens", () => {
    const action = compactEventToAction({
      type: "context_near_limit",
      ratio: 0.55,
      tokens: 55_000,
      contextWindow: 100_000,
      inputBudget: 100_000,
    });
    expect(action).toEqual({
      type: "add_system",
      level: "warn",
      text: "⚠ context 55% full (55,000 tokens) — compact will trigger soon",
    });
  });

  it("context_compacting → info with percentage and tokens", () => {
    const action = compactEventToAction({
      type: "context_compacting",
      ratio: 0.7,
      tokens: 70_000,
    });
    expect(action).toEqual({
      type: "add_system",
      level: "info",
      text: "🗜 compacting — 70% of context used (70,000 tokens)",
    });
  });

  it("context_compacted → info with summarized / kept / anchor", () => {
    const action = compactEventToAction({
      type: "context_compacted",
      summarized: 15,
      kept: 11,
      anchorName: "compact-1700000000000",
    });
    expect(action).toEqual({
      type: "add_system",
      level: "info",
      text: "✓ compacted — 15 older turns → kept 11 recent · compact-1700000000000",
    });
  });

  it("context_compacted singularizes when summarized === 1", () => {
    const action = compactEventToAction({
      type: "context_compacted",
      summarized: 1,
      kept: 10,
    });
    expect(action?.text).toContain("1 older turn → kept 10 recent");
  });

  it("compact_failed → error with the error message", () => {
    const action = compactEventToAction({
      type: "compact_failed",
      error: "tape broked",
    });
    expect(action).toEqual({
      type: "add_system",
      level: "error",
      text: "✗ compact failed: tape broked",
    });
  });

  it("returns null when type is empty", () => {
    expect(compactEventToAction({ type: "" })).toBeNull();
  });

  it("unknown type → info with fallback text", () => {
    const action = compactEventToAction({ type: "future_event" });
    expect(action).toEqual({
      type: "add_system",
      level: "info",
      text: "[compact] future_event",
    });
  });
});
