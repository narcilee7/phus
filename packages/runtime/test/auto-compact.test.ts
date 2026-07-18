// test/auto-compact.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "../src/core/session/tape";
import { shouldCompact, maybeCompact, estimateTokens, DEFAULT_AUTO_COMPACT } from "../src/core/session/auto-compact";

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

describe("shouldCompact", () => {
  it("fires when messages > maxMessages", () => {
    const msgs = Array(101).fill({ content: "x" });
    const reason = shouldCompact(msgs, undefined);
    expect(reason).toContain("maxMessages");
  });

  it("fires when token ratio > maxContextFraction", () => {
    // 8000 tokens, 10000 context = 80% > 70%
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

describe("maybeCompact", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-ac-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("returns fired=false when below threshold", async () => {
    const msgs = Array(5).fill({ content: "x" });
    const r = await maybeCompact(tape, "s", msgs, 200_000);
    expect(r.fired).toBe(false);
  });

  it("compacts and creates anchor when triggered", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const msgs = Array(150).fill({ content: "x" });
    const r = await maybeCompact(tape, "test", msgs, undefined, { ...DEFAULT_AUTO_COMPACT, maxMessages: 100 });
    expect(r.fired).toBe(true);
    expect(r.summarized).toBe(10); // 20 turns - 10 keepRecent

    const anchors = Array.from(tape.replay("test")).filter((e) => e.kind === "anchor");
    expect(anchors).toHaveLength(1);
  });
});
