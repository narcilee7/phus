import { describe, expect, it } from "vitest";
import { asSessionId, type SessionId } from "@phus/core/types/brand.js";
import {
  SessionRuntimeRegistry,
  type ManagedSessionRuntime,
} from "../src/bridge/session-runtime-registry.js";

interface PermissionRequest {
  name: string;
}

class FakeRuntime implements ManagedSessionRuntime<
  string,
  string,
  string,
  PermissionRequest
> {
  messages = 0;
  checkpoints = 0;
  disposed = false;
  permissionHandler?: (request: PermissionRequest) => Promise<boolean>;
  readonly agentHandlers = new Set<(event: string) => void>();
  readonly planHandlers = new Set<(event: string) => void>();
  readonly compactHandlers = new Set<(event: string) => void>();

  constructor(readonly sessionId: SessionId) {}

  hasMessages(): boolean {
    return this.messages > 0;
  }

  saveCheckpoint(): void {
    this.checkpoints++;
  }

  setToolPermissionHandler(
    handler: (request: PermissionRequest) => Promise<boolean>,
  ): void {
    this.permissionHandler = handler;
  }

  subscribeToAgentEvents(handler: (event: string) => void): () => void {
    this.agentHandlers.add(handler);
    return () => this.agentHandlers.delete(handler);
  }

  subscribeToPlanEvents(handler: (event: string) => void): () => void {
    this.planHandlers.add(handler);
    return () => this.planHandlers.delete(handler);
  }

  subscribeToCompactEvents(handler: (event: string) => void): () => void {
    this.compactHandlers.add(handler);
    return () => this.compactHandlers.delete(handler);
  }

  dispose(): void {
    this.disposed = true;
    this.agentHandlers.clear();
    this.planHandlers.clear();
    this.compactHandlers.clear();
  }

  emitAgent(event: string): void {
    for (const handler of this.agentHandlers) handler(event);
  }
}

function registry(options: { maxRuntimes?: number; now?: () => number } = {}) {
  const created: FakeRuntime[] = [];
  const value = new SessionRuntimeRegistry<
    string,
    string,
    string,
    PermissionRequest,
    FakeRuntime
  >((sessionId) => {
    const runtime = new FakeRuntime(sessionId);
    created.push(runtime);
    return runtime;
  }, options);
  return { value, created };
}

describe("SessionRuntimeRegistry", () => {
  it("creates one stable runtime per Session", () => {
    const ctx = registry();
    const id = asSessionId("s1");
    expect(ctx.value.getOrCreate(id)).toBe(ctx.value.getOrCreate(id));
    expect(ctx.created).toHaveLength(1);
  });

  it("serializes work for the same Session in FIFO order", async () => {
    const ctx = registry();
    const id = asSessionId("s1");
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = ctx.value.runExclusive(id, async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = ctx.value.runExclusive(id, async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("allows different Sessions to overlap", async () => {
    const ctx = registry();
    const active = new Set<string>();
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = (id: string) => ctx.value.runExclusive(asSessionId(id), async () => {
      active.add(id);
      maxActive = Math.max(maxActive, active.size);
      await gate;
      active.delete(id);
    });

    const first = run("s1");
    const second = run("s2");
    await Promise.resolve();
    expect(maxActive).toBe(2);
    release();
    await Promise.all([first, second]);
  });

  it("checkpoints the previous selected runtime before switching", () => {
    const ctx = registry();
    const first = ctx.value.setSelected(asSessionId("s1"));
    first.messages = 1;
    const second = ctx.value.setSelected(asSessionId("s2"));

    expect(first.checkpoints).toBe(1);
    expect(ctx.value.getSelected()).toBe(second);
  });

  it("evicts the least recently used idle non-selected runtime", () => {
    let now = 0;
    const ctx = registry({ maxRuntimes: 2, now: () => ++now });
    const selected = ctx.value.setSelected(asSessionId("selected"));
    const old = ctx.value.getOrCreate(asSessionId("old"));
    old.messages = 1;
    const fresh = ctx.value.getOrCreate(asSessionId("fresh"));

    expect(selected.disposed).toBe(false);
    expect(old.checkpoints).toBe(1);
    expect(old.disposed).toBe(true);
    expect(fresh.disposed).toBe(false);
    expect(ctx.value.list()).toHaveLength(2);
  });

  it("temporarily exceeds the cap when every eviction candidate is busy", async () => {
    const ctx = registry({ maxRuntimes: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const busy = ctx.value.runExclusive(asSessionId("busy"), async () => gate);
    await Promise.resolve();

    ctx.value.setSelected(asSessionId("selected"));
    expect(ctx.value.list()).toHaveLength(2);
    release();
    await busy;
    expect(ctx.value.list()).toHaveLength(1);
  });

  it("fans subscriptions and permissions out to existing and future runtimes", async () => {
    const ctx = registry();
    const first = ctx.value.getOrCreate(asSessionId("s1"));
    const events: string[] = [];
    const unsubscribe = ctx.value.subscribeToAgentEvents((event) => events.push(event));
    ctx.value.setToolPermissionHandler(async ({ name }) => name === "allowed");
    const second = ctx.value.getOrCreate(asSessionId("s2"));

    first.emitAgent("one");
    second.emitAgent("two");
    expect(events).toEqual(["one", "two"]);
    expect(await first.permissionHandler?.({ name: "allowed" })).toBe(true);
    expect(await second.permissionHandler?.({ name: "denied" })).toBe(false);

    unsubscribe();
    second.emitAgent("ignored");
    expect(events).toEqual(["one", "two"]);
  });

  it("disposes each runtime without allowing future access", () => {
    const ctx = registry();
    const first = ctx.value.getOrCreate(asSessionId("s1"));
    const second = ctx.value.getOrCreate(asSessionId("s2"));
    ctx.value.disposeAll();

    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(true);
    expect(() => ctx.value.getOrCreate(asSessionId("s3"))).toThrow("disposed");
  });
});
