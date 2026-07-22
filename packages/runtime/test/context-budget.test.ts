// test/context-budget.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  buildSnapshot,
  classifyTier,
  estimateMessagesTokens,
  estimateTextTokens,
  estimateToolsTokens,
  DEFAULT_BUDGET_CONFIG,
  type BudgetLogger,
} from "@phus/core/session/context-budget.js";

describe("estimateTextTokens", () => {
  it("returns 0 for empty / undefined", () => {
    expect(estimateTextTokens(undefined)).toBe(0);
    expect(estimateTextTokens("")).toBe(0);
  });

  it("applies char/4 heuristic (ceil)", () => {
    expect(estimateTextTokens("hello")).toBe(2); // 5/4 = 1.25 → 2
    expect(estimateTextTokens("a".repeat(100))).toBe(25);
  });
});

describe("estimateMessagesTokens", () => {
  it("returns 0 for empty / undefined", () => {
    expect(estimateMessagesTokens(undefined)).toBe(0);
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("counts string content + 50 per message overhead", () => {
    // 8 chars / 4 = 2 + 50/4 = 12.5 → ceil 13
    const m = [{ content: "hello wo" }];
    expect(estimateMessagesTokens(m)).toBeGreaterThan(12);
  });

  it("counts text content parts", () => {
    const m = [{ content: [{ text: "abc" }, { text: "defg" }] }];
    const tokens = estimateMessagesTokens(m);
    expect(tokens).toBeGreaterThan(0);
  });

  it("ignores non-text parts", () => {
    const m = [{ content: [{ type: "image", data: "blob" }, { text: "hi" }] }];
    expect(estimateMessagesTokens(m)).toBeGreaterThan(0);
  });
});

describe("estimateToolsTokens", () => {
  it("returns 0 for empty / undefined", () => {
    expect(estimateToolsTokens(undefined)).toBe(0);
    expect(estimateToolsTokens([])).toBe(0);
  });

  it("counts JSON serialization length", () => {
    // JSON of an empty object is 2 chars / 4 = 1
    expect(estimateToolsTokens([{}])).toBe(1);
  });

  it("returns 0 for non-serializable input", () => {
    const circular: any = {};
    circular.self = circular;
    expect(estimateToolsTokens([circular])).toBe(0);
  });

  it("counts representative TypeBox-shape tool definitions", () => {
    const tools = [
      { name: "bash", description: "run a shell command", parameters: { type: "object", properties: { cmd: { type: "string" } } } },
      { name: "file_read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
      { name: "file_write", description: "write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
    ];
    const tokens = estimateToolsTokens(tools);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("buildSnapshot", () => {
  it("inputBudget = contextWindow - maxOutputTokens", () => {
    const s = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 8_000,
      messages: [{ content: "x" }],
    });
    expect(s.inputBudget).toBe(92_000);
    expect(s.tier).toBe("ok");
  });

  it("uses reportedInput when provided (exact API count)", () => {
    const s = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 8_000,
      messages: [{ content: "x".repeat(100_000) }],
      reportedInput: 50_000,
    });
    expect(s.total).toBe(50_000);
    expect(s.reportedInput).toBe(50_000);
  });

  it("sums message + system + tool tokens when reportedInput is absent", () => {
    const s = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 0,
      systemPrompt: "a".repeat(400), // 100 tokens
      tools: [{ name: "t" }], // small JSON
      messages: [{ content: "b".repeat(400) }], // 100 tokens
    });
    expect(s.systemPromptTokens).toBe(100);
    expect(s.messageTokens).toBeGreaterThan(100);
    expect(s.total).toBeGreaterThanOrEqual(s.messageTokens + s.systemPromptTokens);
  });

  it("clamps inputBudget when maxOutputTokens > contextWindow (defensive)", () => {
    const warnings: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    const logger: BudgetLogger = { warn: (e, p) => warnings.push({ event: e, payload: p }) };
    const s = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 200_000, // provider misreports
      messages: [{ content: "x" }],
    }, logger);
    expect(s.inputBudget).toBe(50_000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.event).toBe("context.max_output_exceeds_window");
  });

  it("tier classification: ok / near_limit / compact", () => {
    // ratio = 0.4 → ok
    const okSnap = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 0,
      reportedInput: 40_000,
    });
    expect(okSnap.tier).toBe("ok");
    expect(okSnap.ratio).toBeCloseTo(0.4, 1);

    // ratio = 0.55 → near_limit (uses DEFAULT_BUDGET_CONFIG)
    const nearSnap = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 0,
      reportedInput: 55_000,
    });
    expect(nearSnap.tier).toBe("near_limit");

    // ratio = 0.7 → compact
    const compactSnap = buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 0,
      reportedInput: 70_000,
    });
    expect(compactSnap.tier).toBe("compact");
  });

  it("tier is ok when contextWindow is missing", () => {
    const s = buildSnapshot({ messages: [{ content: "x" }] });
    expect(s.tier).toBe("ok");
    expect(s.inputBudget).toBe(0);
  });

  it("emits the max_output warn only once per call", () => {
    const warn = vi.fn();
    const logger: BudgetLogger = { warn };
    buildSnapshot({
      contextWindow: 100_000,
      maxOutputTokens: 200_000,
      messages: [{ content: "x" }],
    }, logger);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("classifyTier", () => {
  const snapshot = buildSnapshot({
    contextWindow: 100_000,
    maxOutputTokens: 0,
    reportedInput: 55_000,
  });

  it("returns 'ok' below warnFraction", () => {
    expect(
      classifyTier({ ...snapshot, ratio: 0.4 }, { warnFraction: 0.5, maxContextFraction: 0.6 }),
    ).toBe("ok");
  });

  it("returns 'near_limit' between warnFraction and maxContextFraction", () => {
    expect(
      classifyTier({ ...snapshot, ratio: 0.55 }, { warnFraction: 0.5, maxContextFraction: 0.6 }),
    ).toBe("near_limit");
  });

  it("returns 'compact' at or above maxContextFraction", () => {
    expect(
      classifyTier({ ...snapshot, ratio: 0.7 }, { warnFraction: 0.5, maxContextFraction: 0.6 }),
    ).toBe("compact");
    expect(
      classifyTier({ ...snapshot, ratio: 0.6 }, { warnFraction: 0.5, maxContextFraction: 0.6 }),
    ).toBe("compact");
  });

  it("returns 'ok' when contextWindow is undefined", () => {
    expect(
      classifyTier({ ...snapshot, contextWindow: undefined, ratio: 0.99 }, DEFAULT_BUDGET_CONFIG),
    ).toBe("ok");
  });

  it("respects custom thresholds", () => {
    expect(
      classifyTier({ ...snapshot, ratio: 0.45 }, { warnFraction: 0.4, maxContextFraction: 0.5 }),
    ).toBe("near_limit");
  });
});
