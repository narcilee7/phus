// test/provider-mesh/routing.test.ts
import { describe, expect, it } from "vitest";
import {
  pickByStrategy,
  routeFailover,
  routeWeighted,
  routeCostFirst,
  routeLatencyFirst,
} from "../src/llm/provider-mesh/routing";
import { avg } from "../src/llm/provider-mesh/stats";
import type { EndpointState } from "../src/llm/provider-mesh/types";

function makeState(overrides: Partial<EndpointState>): EndpointState {
  return {
    spec: { name: "x", provider: "p", modelId: "m", ...overrides.spec },
    circuit: "closed",
    consecutiveFailures: 0,
    latencies: [],
    totalSuccess: 0,
    totalFailure: 0,
    ...overrides,
  };
}

describe("routeFailover", () => {
  it("returns lowest priority, breaking ties by declaration order", () => {
    const a = makeState({ spec: { name: "a", provider: "p", modelId: "m", priority: 5 } });
    const b = makeState({ spec: { name: "b", provider: "p", modelId: "m", priority: 1 } });
    const c = makeState({ spec: { name: "c", provider: "p", modelId: "m", priority: 3 } });
    expect(routeFailover([a, b, c]).spec.name).toBe("b");
  });

  it("defaults priority to 0 when missing", () => {
    const a = makeState({ spec: { name: "a", provider: "p", modelId: "m" } });
    const b = makeState({ spec: { name: "b", provider: "p", modelId: "m", priority: -1 } });
    expect(routeFailover([a, b]).spec.name).toBe("b");
  });
});

describe("routeWeighted", () => {
  it("respects weights with a deterministic rng", () => {
    const a = makeState({ spec: { name: "a", provider: "p", modelId: "m", weight: 1 } });
    const b = makeState({ spec: { name: "b", provider: "p", modelId: "m", weight: 3 } });
    // rng returns 0 → first endpoint. rng returns 0.99/4 → b.
    expect(routeWeighted([a, b], () => 0).spec.name).toBe("a");
    expect(routeWeighted([a, b], () => 0.99).spec.name).toBe("b");
  });

  it("falls back to the last candidate if rounding eats the budget", () => {
    const a = makeState({ spec: { name: "a", provider: "p", modelId: "m", weight: 1 } });
    const b = makeState({ spec: { name: "b", provider: "p", modelId: "m", weight: 1 } });
    // rng returns 0.9999999 → should fall through to last element.
    expect(routeWeighted([a, b], () => 0.9999999).spec.name).toBe("b");
  });
});

describe("routeCostFirst", () => {
  it("picks the lowest input+output cost", () => {
    const a = makeState({
      spec: { name: "a", provider: "p", modelId: "m", costPerMillion: { input: 1, output: 1 } },
    });
    const b = makeState({
      spec: { name: "b", provider: "p", modelId: "m", costPerMillion: { input: 5, output: 5 } },
    });
    const c = makeState({
      spec: { name: "c", provider: "p", modelId: "m", costPerMillion: { input: 0.1, output: 0.1 } },
    });
    expect(routeCostFirst([a, b, c]).spec.name).toBe("c");
  });

  it("treats missing cost as Infinity (last place)", () => {
    const cheap = makeState({
      spec: { name: "cheap", provider: "p", modelId: "m", costPerMillion: { input: 1, output: 1 } },
    });
    const unknown = makeState({ spec: { name: "unknown", provider: "p", modelId: "m" } });
    expect(routeCostFirst([unknown, cheap]).spec.name).toBe("cheap");
  });
});

describe("routeLatencyFirst", () => {
  it("picks the endpoint with the lowest recent average latency", () => {
    const slow = makeState({
      spec: { name: "slow", provider: "p", modelId: "m" },
      latencies: [400, 410, 420],
    });
    const fast = makeState({
      spec: { name: "fast", provider: "p", modelId: "m" },
      latencies: [10, 20, 30],
    });
    expect(routeLatencyFirst([slow, fast]).spec.name).toBe("fast");
    expect(avg(slow.latencies)).toBeGreaterThan(avg(fast.latencies)!);
  });

  it("puts endpoints without latency data last", () => {
    const unknown = makeState({ spec: { name: "unknown", provider: "p", modelId: "m" } });
    const measured = makeState({
      spec: { name: "measured", provider: "p", modelId: "m" },
      latencies: [50],
    });
    expect(routeLatencyFirst([unknown, measured]).spec.name).toBe("measured");
  });
});

describe("pickByStrategy", () => {
  it("dispatches to the right strategy", () => {
    const failoverLow = makeState({ spec: { name: "low", provider: "p", modelId: "m", priority: 0 } });
    const failoverHigh = makeState({ spec: { name: "high", provider: "p", modelId: "m", priority: 5 } });
    expect(pickByStrategy("failover", [failoverHigh, failoverLow])!.spec.name).toBe("low");
  });

  it("returns undefined for empty candidate list regardless of strategy", () => {
    expect(pickByStrategy("failover", [])).toBeUndefined();
    expect(pickByStrategy("weighted", [], () => 0.5)).toBeUndefined();
    expect(pickByStrategy("cost-first", [])).toBeUndefined();
    expect(pickByStrategy("latency-first", [])).toBeUndefined();
  });
});