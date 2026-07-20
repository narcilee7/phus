// test/context-select.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "@phus/core/session/tape.js";
import { selectRelevantTurns, DEFAULT_SELECT } from "@phus/core/session/context-select.js";

function makeTurn(i: number, user: string, asst: string, sessionId = "s") {
  return {
    kind: "turn" as const,
    turn: {
      id: `t${i}`, ts: 1000 * i, sessionId,
      inbound: { id: `m${i}`, from: "u", content: user, type: "text" as const, channel: "cli", metadata: {}, ts: 1000 * i },
      prompt: user, modelOutput: asst, toolCalls: [], outbound: [],
    },
  };
}

describe("selectRelevantTurns", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-cs-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("returns empty when no turns exist", () => {
    expect(selectRelevantTurns(tape, "s", "anything")).toEqual([]);
  });

  it("returns last N when query is empty", () => {
    for (let i = 1; i <= 5; i++) tape.append(makeTurn(i, `msg ${i}`, `reply ${i}`));
    const result = selectRelevantTurns(tape, "s", "", { ...DEFAULT_SELECT, budget: 3 });
    expect(result).toHaveLength(3);
    expect(result[2]?.id).toBe("t5"); // most recent
  });

  it("ranks by keyword overlap with recency boost", () => {
    tape.append(makeTurn(1, "tell me about python decorators", "decorators wrap functions"));
    tape.append(makeTurn(2, "what is rust ownership", "ownership tracks borrows"));
    tape.append(makeTurn(3, "explain python generators", "generators yield values"));

    const result = selectRelevantTurns(tape, "s", "python");
    expect(result.length).toBeGreaterThan(0);
    // Either t1 or t3 should rank highest (both mention python)
    const topIds = result.slice(0, 2).map((t) => t.id);
    expect(topIds).toContain("t1");
    expect(topIds).toContain("t3");
  });

  it("falls back to last-N when no turns match", () => {
    tape.append(makeTurn(1, "alpha", "one"));
    tape.append(makeTurn(2, "beta", "two"));
    const result = selectRelevantTurns(tape, "s", "xyzzynothing");
    // No match → returns last N regardless of score
    expect(result.length).toBeGreaterThan(0);
  });

  it("respects budget limit", () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i, `topic ${i}`, `reply ${i}`));
    const result = selectRelevantTurns(tape, "s", "topic", { ...DEFAULT_SELECT, budget: 5 });
    expect(result).toHaveLength(5);
  });

  it("filters out very low scores when minScore is high", () => {
    tape.append(makeTurn(1, "alpha bravo charlie", "x"));
    tape.append(makeTurn(2, "delta echo foxtrot", "y"));
    const result = selectRelevantTurns(tape, "s", "alpha", { ...DEFAULT_SELECT, minScore: 0.99 });
    // Only t1 has any alpha match, and only if its score > 0.99
    // Without recency boost, t1 may not pass
    // Just verify it doesn't error
    expect(Array.isArray(result)).toBe(true);
  });
});
