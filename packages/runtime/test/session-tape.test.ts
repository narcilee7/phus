import { afterEach, describe, expect, it } from "vitest";
import { asSessionId, asToolCallId, asTurnId } from "@phus/core/types/brand.js";
import type { TapeEntry } from "@phus/core/types/tape/index.js";
import { SessionStorage } from "@phus/core/session/session-storage.js";
import { SessionStore } from "@phus/core/session/session-store.js";
import { SessionTape } from "@phus/core/session/session-tape.js";
import { Tape } from "@phus/core/session/tape.js";

let storage: SessionStorage | undefined;
let store: SessionStore | undefined;
let tape: Tape | undefined;

afterEach(() => {
  store?.dispose();
  tape?.close();
  storage?.close();
  store = undefined;
  tape = undefined;
  storage = undefined;
});

function openSession(id = "cli:temporal"): {
  id: ReturnType<typeof asSessionId>;
  storage: SessionStorage;
  store: SessionStore;
  tape: Tape;
  sessionTape: SessionTape;
} {
  storage = new SessionStorage(":memory:");
  tape = new Tape(storage);
  store = new SessionStore(storage);
  const sessionId = asSessionId(id);
  return {
    id: sessionId,
    storage,
    store,
    tape,
    sessionTape: new SessionTape({ sessionId, storage, tape, sessionStore: store }),
  };
}

function turnEntry(sessionId: ReturnType<typeof asSessionId>, ts: number, content: string): TapeEntry {
  return {
    kind: "turn",
    turn: {
      id: asTurnId(`turn-${ts}-${content}`),
      ts,
      sessionId,
      inbound: {
        id: `message-${ts}`,
        from: "user",
        content,
        type: "text",
        channel: "cli",
        metadata: {},
        ts,
      },
      prompt: content,
      modelOutput: `reply: ${content}`,
      toolCalls: [],
      outbound: [],
      durationMs: 1,
    },
  };
}

describe("SessionTape", () => {
  it("catalogs the fenced Session on its first temporal write", () => {
    const ctx = openSession();
    expect(ctx.store.get(ctx.id)).toBeUndefined();

    ctx.sessionTape.append({
      kind: "tool_call",
      sessionId: ctx.id,
      toolCallId: asToolCallId("tool-1"),
      name: "file_read",
      args: {},
      ts: 10,
    });

    expect(ctx.store.get(ctx.id)?.origin.channel).toBe("cli");
    expect(Array.from(ctx.sessionTape.replay())).toHaveLength(1);
  });

  it("rejects cross-session writes before changing Tape or the catalog", () => {
    const ctx = openSession();
    const other = asSessionId("cli:other");

    expect(() => ctx.sessionTape.append(turnEntry(other, 10, "wrong")))
      .toThrow("SessionTape fence");
    expect(Array.from(ctx.tape.replay())).toEqual([]);
    expect(ctx.store.get(ctx.id)).toBeUndefined();
    expect(ctx.store.get(other)).toBeUndefined();
  });

  it("updates lastTurnAt atomically and never regresses it", () => {
    const ctx = openSession();
    ctx.sessionTape.append(turnEntry(ctx.id, 200, "newer"));
    expect(ctx.store.get(ctx.id)?.lastTurnAt).toBe(200);

    ctx.sessionTape.append(turnEntry(ctx.id, 100, "older"));
    expect(ctx.store.get(ctx.id)?.lastTurnAt).toBe(200);

    ctx.sessionTape.append({
      kind: "tool_result",
      sessionId: ctx.id,
      toolCallId: asToolCallId("tool-1"),
      result: "ok",
      isError: false,
      ts: 300,
    });
    expect(ctx.store.get(ctx.id)?.lastTurnAt).toBe(200);
    expect(Array.from(ctx.sessionTape.replay())).toHaveLength(3);
  });

  it("fences replay, summary, and anchors to one Session", () => {
    const ctx = openSession();
    ctx.sessionTape.append(turnEntry(ctx.id, 100, "session temporal design"));
    ctx.sessionTape.append({
      kind: "anchor",
      sessionId: ctx.id,
      name: "current",
      state: { ok: true },
      args: {},
      ts: 110,
    });
    ctx.tape.append(turnEntry(asSessionId("cli:other"), 120, "other content"));

    expect(Array.from(ctx.sessionTape.replay())).toHaveLength(2);
    expect(ctx.sessionTape.summary()).toContain("session temporal design");
    expect(ctx.sessionTape.summary()).not.toContain("other content");
    expect(ctx.sessionTape.loadAnchor()?.name).toBe("current");
  });

  it("delegates checkpoint save, load, list, and pruning", () => {
    const ctx = openSession();
    ctx.sessionTape.saveCheckpoint([{ role: "user", content: "one" }], asTurnId("turn-1"));
    ctx.sessionTape.saveCheckpoint([{ role: "user", content: "two" }], asTurnId("turn-2"));
    ctx.sessionTape.saveCheckpoint([{ role: "user", content: "three" }], asTurnId("turn-3"));

    expect(ctx.sessionTape.loadLatestCheckpoint()?.turnId).toBe("turn-3");
    expect(ctx.sessionTape.listCheckpoints().map((entry) => entry.turnId))
      .toEqual(["turn-3", "turn-2", "turn-1"]);
    expect(ctx.sessionTape.pruneCheckpoints(2)).toBe(1);
    expect(ctx.sessionTape.listCheckpoints()).toHaveLength(2);
  });

  it("delegates compaction and relevant-turn selection", async () => {
    const ctx = openSession();
    ctx.sessionTape.append(turnEntry(ctx.id, 100, "alpha architecture"));
    ctx.sessionTape.append(turnEntry(ctx.id, 200, "beta storage"));
    ctx.sessionTape.append(turnEntry(ctx.id, 300, "gamma runtime"));

    const selected = ctx.sessionTape.selectRelevantTurns("storage", {
      budget: 2,
      minScore: 0,
      recencyWeight: 0,
    });
    expect(selected[0]?.inbound.content).toBe("beta storage");

    const result = await ctx.sessionTape.compact({ keepRecent: 1 });
    expect(result.summarized).toBe(2);
    expect(ctx.sessionTape.loadAnchor()?.name).toBe(result.anchorName);
  });

  it("delegates auto-compaction exactly once", async () => {
    const ctx = openSession();
    ctx.sessionTape.append(turnEntry(ctx.id, 100, "first"));
    ctx.sessionTape.append(turnEntry(ctx.id, 200, "second"));
    const before = Array.from(ctx.sessionTape.replay())
      .filter((entry) => entry.kind === "anchor").length;

    const decision = await ctx.sessionTape.maybeCompact({
      messages: [{ role: "user", content: "one" }, { role: "assistant", content: "two" }],
      contextWindow: undefined,
      cfg: {
        maxMessages: 1,
        maxContextFraction: 0.6,
        keepRecent: 1,
        warnFraction: 0.5,
        reserveOutputTokens: 0,
      },
    });

    const after = Array.from(ctx.sessionTape.replay())
      .filter((entry) => entry.kind === "anchor").length;
    expect(decision.fired).toBe(true);
    expect(after - before).toBe(1);
  });
});
