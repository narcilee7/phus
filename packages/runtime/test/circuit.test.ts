// test/provider-mesh/circuit.test.ts
import { describe, expect, it, vi } from "vitest";
import { isAvailable, recordSuccess, recordFailure, type CircuitChangeEvent } from "../src/llm/provider-mesh/circuit";
import type { EndpointState, MeshPolicy } from "../src/llm/provider-mesh/types";

function makeState(over: Partial<EndpointState> = {}): EndpointState {
  return {
    spec: { name: "ep", provider: "p", modelId: "m" },
    circuit: "closed",
    consecutiveFailures: 0,
    latencies: [],
    totalSuccess: 0,
    totalFailure: 0,
    ...over,
  };
}

const DEFAULT_POLICY: MeshPolicy = {
  cbFailureThreshold: 3,
  cbCooldownMs: 60_000,
};

describe("isAvailable", () => {
  it("returns true for closed circuits", () => {
    expect(isAvailable(makeState(), DEFAULT_POLICY, 0)).toBe(true);
  });

  it("returns true for half-open circuits without transitioning", () => {
    const ep = makeState({ circuit: "half-open" });
    const events: CircuitChangeEvent[] = [];
    expect(isAvailable(ep, DEFAULT_POLICY, 0, (e) => events.push(e))).toBe(true);
    expect(events).toEqual([]);
  });

  it("keeps an open circuit closed until the cooldown elapses", () => {
    const ep = makeState({ circuit: "open", openedAt: 0 });
    expect(isAvailable(ep, DEFAULT_POLICY, 30_000)).toBe(false);
    expect(ep.circuit).toBe("open");
  });

  it("transitions open → half-open when the cooldown has elapsed", () => {
    const ep = makeState({ circuit: "open", openedAt: 0 });
    const events: CircuitChangeEvent[] = [];
    expect(isAvailable(ep, DEFAULT_POLICY, 60_001, (e) => events.push(e))).toBe(true);
    expect(ep.circuit).toBe("half-open");
    expect(events).toEqual([{ name: "ep", state: "half-open" }]);
  });
});

describe("recordSuccess", () => {
  it("records latency, resets failure counter, closes a half-open circuit", () => {
    const ep = makeState({ circuit: "half-open", consecutiveFailures: 5 });
    recordSuccess(ep, 42);
    expect(ep.circuit).toBe("closed");
    expect(ep.consecutiveFailures).toBe(0);
    expect(ep.lastLatencyMs).toBe(42);
    expect(ep.latencies).toEqual([42]);
    expect(ep.totalSuccess).toBe(1);
  });

  it("emits circuit-change when closing an open/half-open circuit", () => {
    const ep = makeState({ circuit: "open" });
    const events: CircuitChangeEvent[] = [];
    recordSuccess(ep, 10, (e) => events.push(e));
    expect(events).toEqual([{ name: "ep", state: "closed" }]);
  });

  it("keeps the latency sliding window bounded at 20", () => {
    const ep = makeState();
    for (let i = 0; i < 30; i++) recordSuccess(ep, i);
    expect(ep.latencies).toHaveLength(20);
    expect(ep.latencies[0]).toBe(10); // first 10 dropped
    expect(ep.latencies[19]).toBe(29);
  });

  it("does not emit when the circuit was already closed", () => {
    const ep = makeState();
    const events: CircuitChangeEvent[] = [];
    recordSuccess(ep, 5, (e) => events.push(e));
    expect(events).toEqual([]);
  });
});

describe("recordFailure", () => {
  it("opens the circuit once the failure threshold is reached", () => {
    const ep = makeState();
    const events: CircuitChangeEvent[] = [];
    recordFailure(ep, DEFAULT_POLICY, new Error("boom"), (e) => events.push(e));
    recordFailure(ep, DEFAULT_POLICY, new Error("boom"));
    expect(ep.circuit).toBe("closed"); // threshold is 3
    recordFailure(ep, DEFAULT_POLICY, new Error("boom"), (e) => events.push(e));
    expect(ep.circuit).toBe("open");
    expect(ep.openedAt).toBeGreaterThan(0);
    expect(events).toEqual([{ name: "ep", state: "open" }]);
  });

  it("does not re-open an already-open circuit (no duplicate emit)", () => {
    const ep = makeState({ circuit: "open", openedAt: 0 });
    const events: CircuitChangeEvent[] = [];
    recordFailure(ep, DEFAULT_POLICY, new Error("x"), (e) => events.push(e));
    expect(ep.circuit).toBe("open");
    expect(events).toEqual([]);
  });
});

describe("circuit lifecycle (closed → open → half-open → closed)", () => {
  it("transitions through the full state machine", () => {
    const ep = makeState();
    const events: CircuitChangeEvent[] = [];
    const observe = (e: CircuitChangeEvent) => events.push(e);
    const T0 = 1_000_000;

    // Drive 3 failures (threshold = 3) → open at T0.
    recordFailure(ep, DEFAULT_POLICY, new Error("a"), observe, T0);
    recordFailure(ep, DEFAULT_POLICY, new Error("b"), observe, T0);
    recordFailure(ep, DEFAULT_POLICY, new Error("c"), observe, T0);
    expect(ep.circuit).toBe("open");
    expect(ep.openedAt).toBe(T0);

    // Still in cooldown at T0 + 30s.
    expect(isAvailable(ep, DEFAULT_POLICY, T0 + 30_000, observe)).toBe(false);
    expect(ep.circuit).toBe("open");

    // Cooldown elapsed → half-open.
    expect(isAvailable(ep, DEFAULT_POLICY, T0 + 60_001, observe)).toBe(true);
    expect(ep.circuit).toBe("half-open");

    // A successful probe closes the circuit.
    recordSuccess(ep, 12, observe);
    expect(ep.circuit).toBe("closed");

    expect(events.map((e) => e.state)).toEqual([
      "open", // from 3rd failure
      "half-open", // from cooldown expiry
      "closed", // from success probe
    ]);
  });
});

vi.mock("@phus/runtime/infra/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));