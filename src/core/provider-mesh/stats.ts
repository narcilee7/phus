// src/core/provider-mesh/stats.ts
// Pure numerical helpers for aggregating endpoint state.

import type { CircuitState, EndpointState } from "./types.js";

/** Sliding-window stats returned by `ProviderMesh#stats()`. */
export interface MeshStats {
  endpoints: Array<{
    name: string;
    circuit: CircuitState;
    totalSuccess: number;
    totalFailure: number;
    avgLatencyMs?: number;
    p95LatencyMs?: number;
    lastHealthOk?: boolean;
  }>;
}

/** Compute the average of `arr`. Returns undefined for an empty array. */
export function avg(arr: readonly number[]): number | undefined {
  if (arr.length === 0) return undefined;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

/** Compute the p-th percentile (0..1) using nearest-rank.
 *  Returns undefined for an empty array. */
export function percentile(arr: readonly number[], p: number): number | undefined {
  if (arr.length === 0) return undefined;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/** Render a snapshot of every endpoint's aggregate state. */
export function statsOf(states: Iterable<EndpointState>): MeshStats {
  const endpoints = [...states].map((s) => ({
    name: s.spec.name,
    circuit: s.circuit,
    totalSuccess: s.totalSuccess,
    totalFailure: s.totalFailure,
    avgLatencyMs: avg(s.latencies),
    p95LatencyMs: percentile(s.latencies, 0.95),
    lastHealthOk: s.lastHealthCheck?.ok,
  }));
  return { endpoints };
}