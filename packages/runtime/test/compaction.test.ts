// test/compaction.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "@phus/core/session/tape";
import { compactSession } from "@phus/core/session/compaction";

function makeTurn(i: number, sessionId = "test") {
  return {
    kind: "turn" as const,
    turn: {
      id: `t${i}`,
      ts: 1000 * i,
      sessionId,
      inbound: {
        id: `m${i}`, from: "u", content: `msg ${i}`, type: "text" as const,
        channel: "cli", metadata: {}, ts: 1000 * i,
      },
      prompt: `msg ${i}`,
      modelOutput: `reply ${i}`,
      toolCalls: [],
      outbound: [],
    },
  };
}

describe("compactSession", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-compact-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("returns early when nothing to compact", async () => {
    for (let i = 1; i <= 5; i++) tape.append(makeTurn(i));
    const r = await compactSession(tape, "test", { keepRecent: 10 });
    expect(r.summarized).toBe(0);
    expect(r.keptRecent).toBe(5);
  });

  it("summarizes old turns, keeps recent intact", async () => {
    for (let i = 1; i <= 20; i++) tape.append(makeTurn(i));
    const r = await compactSession(tape, "test", { keepRecent: 5 });
    expect(r.summarized).toBe(15);
    expect(r.keptRecent).toBe(5);

    const anchors = Array.from(tape.replay("test")).filter((e) => e.kind === "anchor");
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0] as any;
    expect(anchor.name).toContain("compact-");
    expect(anchor.state.kind).toBe("compaction");
    expect(anchor.state.summarizedCount).toBe(15);
    expect(anchor.state.keptRecentCount).toBe(5);
    expect(anchor.state.summary).toContain("msg 1");
    expect(anchor.state.summary).toContain("msg 15");
    // Recent turns (16-20) should NOT be in the summary.
    expect(anchor.state.summary).not.toContain("msg 16");
  });

  it("uses custom summarizer when provided", async () => {
    for (let i = 1; i <= 12; i++) tape.append(makeTurn(i));
    const r = await compactSession(tape, "test", {
      keepRecent: 2,
      summarizeWith: async (turns) => `CUSTOM: ${turns.length} turns`,
    });
    expect(r.summary).toBe("CUSTOM: 10 turns");
  });

  it("respects session isolation", async () => {
    for (let i = 1; i <= 15; i++) tape.append(makeTurn(i, "a"));
    for (let i = 1; i <= 3; i++) tape.append(makeTurn(i, "b"));

    await compactSession(tape, "a", { keepRecent: 5 });

    // Session a has anchor, session b has none.
    expect(Array.from(tape.replay("a")).filter((e) => e.kind === "anchor")).toHaveLength(1);
    expect(Array.from(tape.replay("b")).filter((e) => e.kind === "anchor")).toHaveLength(0);
  });
});
