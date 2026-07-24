import { afterEach, describe, expect, it, vi } from "vitest";
import { asSessionId } from "@phus/core/types/brand.js";
import { SessionStorage } from "@phus/core/session/session-storage.js";
import { SessionStore } from "@phus/core/session/session-store.js";
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

function openShared(): {
  storage: SessionStorage;
  tape: Tape;
  store: SessionStore;
} {
  storage = new SessionStorage(":memory:");
  tape = new Tape(storage);
  store = new SessionStore(storage);
  return { storage, tape, store };
}

function appendTurn(target: Tape, sessionId: string, ts: number): void {
  target.append({
    kind: "turn",
    turn: {
      id: `turn-${sessionId}-${ts}`,
      ts,
      sessionId,
      inbound: {
        id: `message-${ts}`,
        from: "user",
        content: "hello",
        type: "text",
        channel: "cli",
        metadata: {},
        ts,
      },
      prompt: "hello",
      modelOutput: "hi",
      toolCalls: [],
      outbound: [],
      durationMs: 1,
    },
  });
}

describe("SessionStore", () => {
  it("creates and loads sessions with supplied or opaque ids", () => {
    store = new SessionStore(":memory:");
    const legacyId = asSessionId("cli:default");
    const legacy = store.create({
      id: legacyId,
      address: { channel: "cli", scope: "legacy", conversationKey: "default" },
      tags: ["imported"],
      metadata: { source: "test" },
      createdAt: 10,
      updatedAt: 20,
    });

    expect(legacy.id).toBe(legacyId);
    expect(store.get(legacyId)).toEqual(legacy);
    expect(legacy.tags).toEqual(["imported"]);
    expect(legacy.metadata).toEqual({ source: "test" });

    const generated = store.create({
      address: { channel: "cli", scope: "test", conversationKey: "new" },
    });
    expect(generated.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.id).not.toContain("cli");
    expect(() => store!.create({
      id: asSessionId(""),
      address: { channel: "cli", scope: "test", conversationKey: "empty-id" },
    })).toThrow("session id cannot be empty");
  });

  it("normalizes empty thread keys and resolves addresses idempotently", () => {
    store = new SessionStore(":memory:");
    const address = { channel: "slack", scope: "workspace:T1", conversationKey: "C1" };
    const session = store.resolveOrCreate(address);

    expect(store.findByAddress({ ...address, threadKey: "" })?.id).toBe(session.id);
    expect(store.resolveOrCreate({ ...address, threadKey: "" }).id).toBe(session.id);
    expect(() => store!.create({ address })).toThrow();
  });

  it("treats different thread keys as different sessions", () => {
    store = new SessionStore(":memory:");
    const base = { channel: "slack", scope: "workspace:T1", conversationKey: "C1" };
    const first = store.resolveOrCreate({ ...base, threadKey: "thread-1" });
    const second = store.resolveOrCreate({ ...base, threadKey: "thread-2" });

    expect(first.id).not.toBe(second.id);
    expect(store.list()).toHaveLength(2);
  });

  it("persists durable status transitions and hides archived sessions by default", () => {
    store = new SessionStore(":memory:");
    const session = store.create({
      address: { channel: "cli", scope: "test", conversationKey: "status" },
      createdAt: 1,
      updatedAt: 1,
    });

    const closed = store.close(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.updatedAt).toBeGreaterThan(1);
    expect(store.reopen(session.id).status).toBe("open");
    expect(store.archive(session.id).status).toBe("archived");
    expect(store.list()).toEqual([]);
    expect(store.list({ includeArchived: true })).toHaveLength(1);
    expect(store.list({ status: "archived" })).toHaveLength(1);
  });

  it("hydrates malformed tags and metadata defensively", () => {
    storage = new SessionStorage(":memory:");
    store = new SessionStore(storage);
    const session = store.create({
      address: { channel: "cli", scope: "test", conversationKey: "malformed" },
    });
    storage.prepare<[string, string, string]>(
      "UPDATE sessions SET tags = ?, metadata = ? WHERE id = ?",
    ).run("not-json", "null", session.id);

    expect(store.get(session.id)?.tags).toEqual([]);
    expect(store.get(session.id)?.metadata).toEqual({});
  });

  it("ensures legacy ids and records turn time monotonically", () => {
    store = new SessionStore(":memory:");
    const id = asSessionId("cli:ensured");

    const first = store.ensure(id);
    expect(first.id).toBe(id);
    expect(first.origin.channel).toBe("cli");
    expect(first.metadata.source).toBe("runtime-compat");
    expect(store.ensure(id)).toEqual(first);

    const recordedAt = first.updatedAt + 10;
    store.recordTurn(id, 200, recordedAt);
    expect(store.get(id)?.lastTurnAt).toBe(200);
    expect(store.get(id)?.updatedAt).toBe(recordedAt);

    store.recordTurn(id, 100, recordedAt - 5);
    expect(store.get(id)?.lastTurnAt).toBe(200);
    expect(store.get(id)?.updatedAt).toBe(recordedAt);
  });

  it("bootstraps every legacy Tape session without mutating Tape", () => {
    const shared = openShared();
    shared.tape.append({ kind: "anchor", sessionId: "cli:default", name: "first", state: {}, ts: 100 });
    const now = vi.spyOn(Date, "now").mockReturnValue(200);
    appendTurn(shared.tape, "cli:default", 200);
    now.mockRestore();
    shared.tape.append({ kind: "anchor", sessionId: "cli:default", name: "last", state: {}, ts: 300 });
    shared.tape.append({ kind: "anchor", sessionId: "slack:C456", name: "slack", state: {}, ts: 90 });
    shared.tape.append({ kind: "anchor", sessionId: "_system", name: "system", state: {}, ts: 50 });
    shared.tape.append({ kind: "anchor", sessionId: "weird", name: "weird", state: {}, ts: 60 });
    shared.tape.append({ kind: "anchor", sessionId: "", name: "empty", state: {}, ts: 70 });
    shared.tape.append({ kind: "anchor", sessionId: "a:b:c", name: "nested", state: {}, ts: 80 });
    const before = Array.from(shared.tape.replay());

    expect(shared.store.bootstrapFromTape()).toEqual({ created: 6, skipped: 0 });
    expect(shared.store.list({ includeArchived: true })).toHaveLength(6);

    const cli = shared.store.get(asSessionId("cli:default"));
    expect(cli?.origin).toEqual({
      channel: "cli",
      scope: "legacy",
      conversationKey: "default",
      threadKey: undefined,
    });
    expect(cli?.createdAt).toBe(100);
    expect(cli?.updatedAt).toBe(300);
    expect(cli?.lastTurnAt).toBe(200);

    expect(shared.store.get(asSessionId("_system"))?.kind).toBe("system");
    expect(shared.store.get(asSessionId("slack:C456"))?.origin.channel).toBe("slack");
    expect(shared.store.get(asSessionId("weird"))?.origin.channel).toBe("legacy");
    expect(shared.store.get(asSessionId(""))?.origin.conversationKey).toBe("");
    expect(shared.store.get(asSessionId("a:b:c"))?.origin.conversationKey).toBe("a:b:c");
    expect(shared.store.get(asSessionId("weird"))?.lastTurnAt).toBeUndefined();

    expect(shared.store.bootstrapFromTape()).toEqual({ created: 0, skipped: 6 });
    expect(Array.from(shared.tape.replay())).toEqual(before);
  });

  it("returns an empty bootstrap result when no Tape table exists", () => {
    store = new SessionStore(":memory:");
    expect(store.bootstrapFromTape()).toEqual({ created: 0, skipped: 0 });
  });

  it("returns an empty bootstrap result for an empty Tape", () => {
    const shared = openShared();
    expect(shared.store.bootstrapFromTape()).toEqual({ created: 0, skipped: 0 });
  });

  it("keeps shared storage alive until its explicit owner closes", () => {
    const shared = openShared();

    shared.tape.close();
    shared.store.dispose();
    expect(shared.storage.isClosed).toBe(false);

    shared.storage.close();
    expect(shared.storage.isClosed).toBe(true);
    expect(() => shared.storage.close()).not.toThrow();
  });
});
