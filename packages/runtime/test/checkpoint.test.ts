// test/checkpoint.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "@phus/core/session/tape";
import { saveCheckpoint, loadLatestCheckpoint, listCheckpoints, pruneCheckpoints } from "@phus/core/session/checkpoint";

describe("checkpoint save/load", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-cp-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("saveCheckpoint appends to tape", () => {
    saveCheckpoint(tape, "s1", [{ role: "user", content: "hi" }], "turn-1");
    const entries = Array.from(tape.replay("s1"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("checkpoint");
  });

  it("loadLatestCheckpoint returns most recent", () => {
    saveCheckpoint(tape, "s1", [{ role: "user", content: "v1" }], "t1");
    saveCheckpoint(tape, "s1", [{ role: "user", content: "v2" }], "t2");
    saveCheckpoint(tape, "s1", [{ role: "user", content: "v3" }], "t3");
    const cp = loadLatestCheckpoint(tape, "s1");
    expect(cp?.turnId).toBe("t3");
  });

  it("loadLatestCheckpoint filters by sessionId", () => {
    saveCheckpoint(tape, "s1", [{ role: "user", content: "a" }], "t1");
    saveCheckpoint(tape, "s2", [{ role: "user", content: "b" }], "t1");
    const cp1 = loadLatestCheckpoint(tape, "s1");
    const cp2 = loadLatestCheckpoint(tape, "s2");
    expect(cp1?.messages).toEqual([{ role: "user", content: "a" }]);
    expect(cp2?.messages).toEqual([{ role: "user", content: "b" }]);
  });

  it("listCheckpoints returns newest first", () => {
    saveCheckpoint(tape, "s1", [{ n: 1 }], "t1");
    saveCheckpoint(tape, "s1", [{ n: 2 }], "t2");
    saveCheckpoint(tape, "s1", [{ n: 3 }], "t3");
    const all = listCheckpoints(tape, "s1");
    expect(all.map((c) => c.turnId)).toEqual(["t3", "t2", "t1"]);
  });

  it("loadLatestCheckpoint returns undefined when no checkpoints", () => {
    expect(loadLatestCheckpoint(tape, "nope")).toBeUndefined();
  });

  it("preserves full message array in messages field", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "toolResult", toolCallId: "x", content: "ok" },
    ];
    saveCheckpoint(tape, "s1", msgs);
    const cp = loadLatestCheckpoint(tape, "s1");
    expect(cp?.messages).toEqual(msgs);
  });
});

describe("checkpoint pruning", () => {
  let dir: string;
  let tape: Tape;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-cp-prune-"));
    process.env.PHUS_TAPE_DB = path.join(dir, "tape.sqlite");
    tape = new Tape(path.join(dir, "tape.sqlite"));
  });

  it("keeps last N checkpoints", () => {
    for (let i = 1; i <= 10; i++) {
      saveCheckpoint(tape, "s1", [{ i }], `t${i}`);
    }
    const deleted = pruneCheckpoints(tape, "s1", 3);
    expect(deleted).toBe(7);
    const remaining = listCheckpoints(tape, "s1");
    expect(remaining).toHaveLength(3);
    // Newest preserved
    expect(remaining[0]?.turnId).toBe("t10");
    expect(remaining[2]?.turnId).toBe("t8");
  });

  it("no-op when count <= keep", () => {
    for (let i = 1; i <= 3; i++) {
      saveCheckpoint(tape, "s1", [{ i }], `t${i}`);
    }
    const deleted = pruneCheckpoints(tape, "s1", 5);
    expect(deleted).toBe(0);
    expect(listCheckpoints(tape, "s1")).toHaveLength(3);
  });
});
