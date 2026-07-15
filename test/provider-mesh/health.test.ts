// test/provider-mesh/health.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  pingHealth,
  createHealthTimer,
  runHealthChecks,
} from "../../src/core/provider-mesh/health.js";
import type { EndpointState, MeshPolicy } from "../../src/core/provider-mesh/types.js";

vi.mock("@/core/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

function makeState(over: Partial<EndpointState> = {}): EndpointState {
  return {
    spec: { name: "ep", provider: "p", modelId: "m", ...over.spec },
    circuit: "closed",
    consecutiveFailures: 0,
    latencies: [],
    totalSuccess: 0,
    totalFailure: 0,
    ...over,
  };
}

describe("pingHealth", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns true for a healthy response (status < 500)", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 200 })) as any;
    expect(await pingHealth("http://ok", 1000)).toBe(true);
  });

  it("returns false for a 5xx response", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 503 })) as any;
    expect(await pingHealth("http://broken", 1000)).toBe(false);
  });

  it("returns false on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as any;
    expect(await pingHealth("http://nowhere", 1000)).toBe(false);
  });
});

describe("createHealthTimer", () => {
  it("starts and stops the timer idempotently", () => {
    const states = new Map<string, EndpointState>();
    const t = createHealthTimer(states.values(), { healthCheckIntervalMs: 60_000 } as MeshPolicy);
    expect(t.isRunning()).toBe(false);
    t.start();
    expect(t.isRunning()).toBe(true);
    t.start(); // second start is a no-op
    expect(t.isRunning()).toBe(true);
    t.stop();
    expect(t.isRunning()).toBe(false);
    t.stop(); // second stop is a no-op
    expect(t.isRunning()).toBe(false);
  });

  it("fires `runHealthChecks` at the configured interval", async () => {
    const ep = makeState({
      spec: { name: "ep", provider: "p", modelId: "m", healthCheckUrl: "http://x" },
    });
    const states = new Map([["ep", ep]]);
    const fetchSpy = vi.fn(async () => ({ status: 200 })) as any;
    globalThis.fetch = fetchSpy;

    // 30 ms interval → wait 80 ms → expect ~2 ticks.
    const t = createHealthTimer(states.values(), { healthCheckIntervalMs: 30 } as MeshPolicy);
    t.start();
    await new Promise((r) => setTimeout(r, 80));
    t.stop();

    // Allow a tolerance of 1 tick — setInterval drift is real.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(ep.lastHealthCheck?.ok).toBe(true);
  });

  it("no fetch is scheduled when no endpoint has a healthCheckUrl", async () => {
    const ep = makeState(); // no healthCheckUrl
    const states = new Map([["ep", ep]]);
    const fetchSpy = vi.fn(async () => ({ status: 200 })) as any;
    globalThis.fetch = fetchSpy;

    const t = createHealthTimer(states.values(), { healthCheckIntervalMs: 20 } as MeshPolicy);
    t.start();
    await new Promise((r) => setTimeout(r, 60));
    t.stop();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ep.lastHealthCheck).toBeUndefined();
  });
});

describe("runHealthChecks", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("happy path sets lastHealthCheck.ok = true", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 204 })) as any;
    const ep = makeState({
      spec: { name: "ep", provider: "p", modelId: "m", healthCheckUrl: "http://x" },
    });
    await runHealthChecks([ep], {} as MeshPolicy);
    expect(ep.lastHealthCheck?.ok).toBe(true);
  });

  it("unhealthy endpoint in closed state increments consecutiveFailures", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 500 })) as any;
    const ep = makeState({
      spec: { name: "ep", provider: "p", modelId: "m", healthCheckUrl: "http://x" },
      consecutiveFailures: 0,
    });
    await runHealthChecks([ep], {} as MeshPolicy);
    expect(ep.lastHealthCheck?.ok).toBe(false);
    expect(ep.consecutiveFailures).toBe(1);
  });

  it("healthy endpoint with an open circuit transitions to half-open", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 200 })) as any;
    const ep = makeState({
      spec: { name: "ep", provider: "p", modelId: "m", healthCheckUrl: "http://x" },
      circuit: "open",
      openedAt: 0,
    });
    await runHealthChecks([ep], {} as MeshPolicy);
    expect(ep.circuit).toBe("half-open");
  });
});