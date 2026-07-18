// src/core/provider-mesh/routing.ts
// Pure routing strategy dispatch. No side effects on the input
// candidates; the caller owns the EndpointState list.

import type { EndpointState, RoutingStrategy } from "./types.js";
import { avg } from "./stats.js";

/** Default random source. Tests inject a deterministic rng. */
export type Rng = () => number;

/** Pick an endpoint per the routing strategy. Returns the first
 *  candidate that wins. Returns undefined if `candidates` is empty.
 *
 *  The returned reference is the actual `EndpointState` (mutating
 *  its circuit / counters is the caller's job, done by `circuit.ts`). */
export function pickByStrategy(
  strategy: RoutingStrategy,
  candidates: readonly EndpointState[],
  rng: Rng = Math.random,
): EndpointState | undefined {
  if (candidates.length === 0) return undefined;
  switch (strategy) {
    case "failover":
      return routeFailover(candidates);
    case "weighted":
      return routeWeighted(candidates, rng);
    case "cost-first":
      return routeCostFirst(candidates);
    case "latency-first":
      return routeLatencyFirst(candidates);
  }
}

/** Lowest priority wins; ties broken by declaration order. */
export function routeFailover(
  candidates: readonly EndpointState[],
): EndpointState {
  return [...candidates].sort((a, b) => (a.spec.priority ?? 0) - (b.spec.priority ?? 0))[0]!;
}

/** Weighted random selection. Total weight = sum of `weight` (default 1). */
export function routeWeighted(
  candidates: readonly EndpointState[],
  rng: Rng,
): EndpointState {
  const totalWeight = candidates.reduce((sum, s) => sum + (s.spec.weight ?? 1), 0);
  let r = rng() * totalWeight;
  for (const s of candidates) {
    r -= s.spec.weight ?? 1;
    if (r <= 0) return s;
  }
  return candidates[candidates.length - 1]!;
}

/** Cheapest input+output cost wins. Unknown cost is treated as +Infinity
 *  (so it's picked last). */
export function routeCostFirst(
  candidates: readonly EndpointState[],
): EndpointState {
  return [...candidates].sort((a, b) => {
    const aCost =
      (a.spec.costPerMillion?.input ?? Infinity) +
      (a.spec.costPerMillion?.output ?? Infinity);
    const bCost =
      (b.spec.costPerMillion?.input ?? Infinity) +
      (b.spec.costPerMillion?.output ?? Infinity);
    return aCost - bCost;
  })[0]!;
}

/** Lowest recent average latency wins. Endpoints without latency data
 *  are pushed to the end (Infinity). */
export function routeLatencyFirst(
  candidates: readonly EndpointState[],
): EndpointState {
  return [...candidates].sort((a, b) => {
    const aLat = avg(a.latencies) ?? Infinity;
    const bLat = avg(b.latencies) ?? Infinity;
    return aLat - bLat;
  })[0]!;
}