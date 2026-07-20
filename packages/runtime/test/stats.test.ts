// test/provider-mesh/stats.test.ts
import { describe, expect, it } from "vitest";
import { avg, percentile, statsOf } from "../src/llm/provider-mesh/stats";
import type { EndpointState } from "../src/llm/provider-mesh/types";

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

describe("avg", () => {
  it("returns undefined for an empty array", () => {
    expect(avg([])).toBeUndefined();
  });

  it("returns the mean of a single-element array", () => {
    expect(avg([42])).toBe(42);
  });

  it("returns the mean of a multi-element array", () => {
    expect(avg([10, 20, 30])).toBe(20);
  });
});

describe("percentile", () => {
  it("returns undefined for an empty array", () => {
    expect(percentile([], 0.95)).toBeUndefined();
  });

  it("p95 over [1..100] lands near the top", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    const p95 = percentile(arr, 0.95)!;
    // Nearest-rank: idx = floor(0.95 * 100) = 95 → sorted[95] = 96.
    expect(p95).toBe(96);
  });

  it("p50 over [1..9] lands at the median", () => {
    const p50 = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.5)!;
    // idx = floor(0.5 * 9) = 4 → sorted[4] = 5
    expect(p50).toBe(5);
  });

  it("does not mutate the input array", () => {
    const arr = [3, 1, 2];
    percentile(arr, 0.95);
    expect(arr).toEqual([3, 1, 2]);
  });
});

describe("statsOf", () => {
  it("aggregates per-endpoint fields", () => {
    const a = makeState({
      spec: { name: "a", provider: "p", modelId: "m" },
      latencies: [10, 20, 30],
      totalSuccess: 5,
      totalFailure: 2,
      lastHealthCheck: { ok: true, ts: 100 },
    });
    const b = makeState({
      spec: { name: "b", provider: "p", modelId: "m" },
      circuit: "open",
    });
    const out = statsOf([a, b]);
    expect(out.endpoints).toHaveLength(2);
    expect(out.endpoints[0]).toMatchObject({
      name: "a",
      totalSuccess: 5,
      totalFailure: 2,
      avgLatencyMs: 20,
      lastHealthOk: true,
    });
    expect(out.endpoints[1]).toMatchObject({
      name: "b",
      circuit: "open",
      totalSuccess: 0,
      totalFailure: 0,
      avgLatencyMs: undefined,
      p95LatencyMs: undefined,
      lastHealthOk: undefined,
    });
  });

  it("returns an empty list for no endpoints", () => {
    expect(statsOf([])).toEqual({ endpoints: [] });
  });
});