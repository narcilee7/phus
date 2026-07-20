// test/tape.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "@phus/core/session/tape";

describe("Tape (SQLite)", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-tape-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("appends and replays entries in order", () => {
    tape.append({ kind: "anchor", sessionId: "s1", name: "init", state: {}, ts: 1000 });
    tape.append({ kind: "anchor", sessionId: "s1", name: "next", state: {}, ts: 2000 });
    tape.append({ kind: "anchor", sessionId: "s2", name: "other", state: {}, ts: 1500 });

    const s1 = Array.from(tape.replay("s1")).map((e) => (e as any).name);
    expect(s1).toEqual(["init", "next"]);

    const all = Array.from(tape.replay()).map((e) => (e as any).name);
    expect(all).toEqual(["init", "other", "next"]); // sorted by ts
  });

  it("summary() returns most recent N turn previews in chronological order", () => {
    const makeTurn = (i: number) => ({
      kind: "turn" as const,
      turn: {
        id: `t${i}`,
        ts: 1000 * i,
        sessionId: "s1",
        inbound: {
          id: `m${i}`, from: "u", content: `hello ${i}`, type: "text" as const,
          channel: "cli", metadata: {}, ts: 1000 * i,
        },
        prompt: `hello ${i}`,
        modelOutput: `reply ${i}`,
        toolCalls: [],
        outbound: [],
      },
    });
    for (let i = 1; i <= 12; i++) tape.append(makeTurn(i));
    const summary = tape.summary("s1", 5);
    expect(summary).toContain("hello 8");
    expect(summary).toContain("hello 12");
    expect(summary.split("\n")).toHaveLength(5);
  });

  it("stats() returns total + per-session counts", () => {
    tape.append({ kind: "anchor", sessionId: "a", name: "x", state: {}, ts: 1 });
    tape.append({ kind: "anchor", sessionId: "a", name: "y", state: {}, ts: 2 });
    tape.append({ kind: "anchor", sessionId: "b", name: "z", state: {}, ts: 3 });
    const s = tape.stats();
    expect(s.totalEntries).toBe(3);
    expect(s.sessions).toEqual({ a: 2, b: 1 });
  });

  it("loadAnchor returns the latest anchor for a session", () => {
    tape.append({ kind: "anchor", sessionId: "s", name: "first", state: { n: 1 }, ts: 100 });
    tape.append({ kind: "anchor", sessionId: "s", name: "last", state: { n: 2 }, ts: 200 });
    const a = tape.loadAnchor("s");
    expect(a?.name).toBe("last");
    if (!a) throw new Error("expected anchor");
    expect((a.state as { n: number }).n).toBe(2);
  });
});
