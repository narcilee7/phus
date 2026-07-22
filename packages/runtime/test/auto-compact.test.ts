// test/auto-compact.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "@phus/core/session/tape.js";
import { shouldCompact, maybeCompact, estimateTokens, DEFAULT_AUTO_COMPACT } from "@phus/core/session/auto-compact.js";
import { buildSummaryMessage } from "@phus/core/session/compaction.js";

function makeTurn(i: number, sessionId = "test") {
  return {
    kind: "turn" as const,
    turn: {
      id: `t${i}`, ts: 1000 * i, sessionId,
      inbound: { id: `m${i}`, from: "u", content: `msg ${i}`, type: "text" as const, channel: "cli", metadata: {}, ts: 1000 * i },
      prompt: `msg ${i}`, modelOutput: `reply ${i}`, toolCalls: [], outbound: [],
    },
  };
}

describe("estimateTokens", () => {
  it("counts string content", () => {
    const tokens = estimateTokens([{ content: "hello world" }]);
    // 11 chars / 4 ≈ 3 tokens + 50 overhead / 4 = ~12.5 → ceil
    expect(tokens).toBeGreaterThan(0);
  });

  it("counts array content", () => {
    const tokens = estimateTokens([{ content: [{ text: "abc" }, { text: "defg" }] }]);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("shouldCompact (legacy message-only heuristic)", () => {
  it("fires when messages > maxMessages", () => {
    const msgs = Array(101).fill({ content: "x" });
    const reason = shouldCompact(msgs, undefined);
    expect(reason).toContain("maxMessages");
  });

  it("fires when token ratio > maxContextFraction", () => {
    // 8000 tokens, 10000 context = 80% > 70% (legacy default)
    const longContent = "x".repeat(30_000); // ~7500 tokens
    const msgs = [{ content: longContent }, { content: longContent }];
    const reason = shouldCompact(msgs, 10000);
    expect(reason).toContain("tokens=");
  });

  it("does not fire when below thresholds", () => {
    const msgs = Array(10).fill({ content: "short" });
    expect(shouldCompact(msgs, 200_000, DEFAULT_AUTO_COMPACT)).toBeNull();
  });

  it("does not fire without context window when messages are short", () => {
    const msgs = Array(50).fill({ content: "short" });
    expect(shouldCompact(msgs, undefined)).toBeNull();
  });
});

describe("maybeCompact (new args-object API)", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-ac-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("returns fired=false when below threshold", async () => {
    const msgs = Array(5).fill({ content: "x" });
    const r = await maybeCompact({
      tape,
      sessionId: "s",
      messages: msgs,
      contextWindow: 200_000,
    });
    expect(r.fired).toBe(false);
    expect(r.tier).toBe("ok");
  });

  it("compacts and creates anchor when triggered (maxMessages fallback)", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const msgs = Array(150).fill({ content: "x" });
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: msgs,
      contextWindow: undefined,
      cfg: { ...DEFAULT_AUTO_COMPACT, maxMessages: 100 },
    });
    expect(r.fired).toBe(true);
    expect(r.tier).toBe("compact");
    expect(r.summarized).toBe(10); // 20 turns - 10 keepRecent

    const anchors = Array.from(tape.replay("test")).filter((e) => e.kind === "anchor");
    expect(anchors).toHaveLength(1);
  });

  it("returns trimmedMessages = undefined when below threshold", async () => {
    const msgs = Array(5).fill({ content: "x" });
    const r = await maybeCompact({
      tape,
      sessionId: "s",
      messages: msgs,
      contextWindow: 200_000,
    });
    expect(r.trimmedMessages).toBeUndefined();
  });

  it("returns trimmedMessages of length keepRecent + 1 (summary + recent) when fired", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const msgs = Array(150).fill({ content: "x" });
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: msgs,
      contextWindow: undefined,
      cfg: { ...DEFAULT_AUTO_COMPACT, maxMessages: 100, keepRecent: 10 },
    });
    expect(r.fired).toBe(true);
    expect(r.trimmedMessages).toBeDefined();
    expect(r.trimmedMessages).toHaveLength(11); // summary + 10 recent
  });

  it("summary message is the first element and starts with [Compaction summary", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const msgs = Array(150).fill({ content: "x" });
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: msgs,
      contextWindow: undefined,
      cfg: { ...DEFAULT_AUTO_COMPACT, maxMessages: 100, keepRecent: 10 },
    });
    const summary = r.trimmedMessages?.[0] as { role: string; content: string };
    expect(summary.role).toBe("user");
    expect(summary.content.startsWith("[Compaction summary")).toBe(true);
  });

  it("preserves the last keepRecent messages after compact", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const messages = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: `msg ${i + 1}` }));
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages,
      contextWindow: undefined,
      cfg: { ...DEFAULT_AUTO_COMPACT, maxMessages: 10, keepRecent: 5 },
    });
    expect(r.fired).toBe(true);
    const trimmed = r.trimmedMessages as Array<{ role: string; content: string }>;
    // First is summary, last 5 are messages 11..15
    expect(trimmed).toHaveLength(6);
    expect(trimmed[1]?.content).toBe("msg 11");
    expect(trimmed[5]?.content).toBe("msg 15");
  });

  it("fires when reportedInput / inputBudget > maxContextFraction (0.6)", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const msgs = Array(50).fill({ content: "short" });
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: msgs,
      contextWindow: 100_000,
      maxOutputTokens: 0,
      lastReportedInput: 70_000, // 70% of 100k
    });
    expect(r.fired).toBe(true);
    expect(r.tier).toBe("compact");
    expect(r.snapshot.ratio).toBeCloseTo(0.7, 1);
  });

  it("emits near_limit tier (no compact) when ratio between warnFraction and maxContextFraction", async () => {
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: [{ content: "short" }],
      contextWindow: 100_000,
      lastReportedInput: 55_000, // 55% — between 0.5 warn and 0.6 compact
    });
    expect(r.fired).toBe(false);
    expect(r.tier).toBe("near_limit");
    expect(r.trimmedMessages).toBeUndefined();
  });

  it("emits context.near_limit log when at near_limit tier", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    await maybeCompact({
      tape,
      sessionId: "test",
      messages: [{ content: "short" }],
      contextWindow: 100_000,
      lastReportedInput: 55_000,
      logger: { info, warn },
    });
    expect(info).toHaveBeenCalledWith("context.near_limit", expect.objectContaining({
      tier: "near_limit",
      ratio: expect.any(Number),
    }));
  });

  it("emits context.compacting log when fired", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const info = vi.fn();
    const warn = vi.fn();
    const r = await maybeCompact({
      tape,
      sessionId: "test",
      messages: [{ content: "short" }],
      contextWindow: 100_000,
      lastReportedInput: 70_000,
      logger: { info, warn },
    });
    expect(r.fired).toBe(true);
    expect(info).toHaveBeenCalledWith("context.compacting", expect.objectContaining({
      tier: "compact",
      summarized: expect.any(Number),
      anchorName: expect.any(String),
    }));
  });

  it("does not compact when compactSession throws — fallback fires=false", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    // Force an error by passing a tape that throws on replay.
    const badTape = {
      replay: () => { throw new Error("tape broked"); },
    } as unknown as Tape;
    const r = await maybeCompact({
      tape: badTape,
      sessionId: "test",
      messages: [{ content: "x" }],
      contextWindow: 100_000,
      lastReportedInput: 70_000,
      logger: { info, warn },
    });
    expect(r.fired).toBe(false);
    expect(r.tier).toBe("compact"); // tier is computed correctly
    expect(warn).toHaveBeenCalledWith("compact.failed", expect.objectContaining({
      tier: "compact",
    }));
  });

  it("emits context.max_output_exceeds_window when maxOutputTokens > contextWindow", async () => {
    const warn = vi.fn();
    await maybeCompact({
      tape,
      sessionId: "test",
      messages: [{ content: "x" }],
      contextWindow: 100_000,
      maxOutputTokens: 200_000,
      lastReportedInput: 50_000,
      logger: { info: vi.fn(), warn },
    });
    expect(warn).toHaveBeenCalledWith("context.max_output_exceeds_window", expect.objectContaining({
      contextWindow: 100_000,
      reportedMaxOutput: 200_000,
    }));
  });
});

describe("buildSummaryMessage", () => {
  it("returns role=user with [Compaction summary prefix", () => {
    const sm = buildSummaryMessage("hello", { anchorName: "compact-1", summarizedCount: 5 });
    expect(sm.role).toBe("user");
    expect(sm.content).toContain("[Compaction summary — compact-1; 5 older turn(s) collapsed]");
    expect(sm.content).toContain("hello");
    expect(sm.content).toContain("[End of compaction summary.");
    expect(typeof sm.timestamp).toBe("number");
  });

  it("defaults anchorName to 'auto' and count to 0", () => {
    const sm = buildSummaryMessage("x");
    expect(sm.content).toContain("[Compaction summary — auto; 0 older turn(s) collapsed]");
  });
});
