// src/core/provider-mesh/index.ts
// ProviderMesh — composes types, routing, circuit, health, and stats
// into a single class. Public API is unchanged from the previous
// monolithic implementation so external consumers (bridge/, internal-
// commands builtins) do not need to change.

import { EventEmitter } from "node:events";
import { logger } from "@/infra/logging.js";
import type { CircuitChangeEvent } from "./circuit.js";
import { isAvailable, recordFailure, recordSuccess } from "./circuit.js";
import { createHealthTimer, type HealthTimer } from "./health.js";
import { endpointToModel } from "./model-builder.js";
import { pickByStrategy } from "./routing.js";
import { statsOf, type MeshStats } from "./stats.js";
import {
  DEFAULT_MESH_POLICY,
  type EndpointSpec,
  type EndpointState,
  type MeshPolicy,
} from "./types.js";
import type { MeshLike } from "./contract.js";

// ─── Public re-exports (kept stable from the monolithic API) ───
export type {
  CircuitState,
  EndpointSpec,
  EndpointState,
  MeshPolicy,
  RoutingStrategy,
} from "./types.js";
export type { MeshStats } from "./stats.js";
export type { MeshLike } from "./contract.js";
export { DEFAULT_MESH_POLICY } from "./types.js";
export { endpointToModel } from "./model-builder.js";
export { pickByStrategy } from "./routing.js";
export {
  isAvailable,
  recordSuccess,
  recordFailure,
  type CircuitChangeEvent,
} from "./circuit.js";

/**
 * Multi-endpoint provider mesh with health checks, circuit breaker,
 * and policy-based routing. Inherits `EventEmitter` and emits
 * `circuit-change` whenever an endpoint transitions between
 * `closed` / `open` / `half-open`.
 */
export class ProviderMesh extends EventEmitter implements MeshLike {
  private readonly endpoints = new Map<string, EndpointState>();
  private readonly policy: Required<MeshPolicy>;
  private readonly health: HealthTimer;

  constructor(specs: EndpointSpec[], policy: MeshPolicy = {}) {
    super();
    this.policy = { ...DEFAULT_MESH_POLICY, ...policy };
    for (const spec of specs) {
      this.endpoints.set(spec.name, {
        spec,
        circuit: "closed",
        consecutiveFailures: 0,
        latencies: [],
        totalSuccess: 0,
        totalFailure: 0,
      });
    }
    // The timer reads `this.endpoints` lazily — a snapshot at tick
    // time is fine because `runHealthChecks` iterates the live map.
    this.health = createHealthTimer(this.endpoints.values(), this.policy);
  }

  /** Get all endpoint specs (for diagnostics). */
  listEndpoints(): EndpointSpec[] {
    return [...this.endpoints.values()].map((s) => s.spec);
  }

  /** Get current state of one endpoint. */
  getEndpoint(name: string): EndpointState | undefined {
    return this.endpoints.get(name);
  }

  /** Get aggregate stats. */
  stats(): MeshStats {
    return statsOf(this.endpoints.values());
  }

  /** Pick an endpoint according to the routing strategy.
   *  Skips endpoints with open circuits and any in `exclude` set.
   *  Returns undefined if all unhealthy. */
  pickEndpoint(exclude: Set<string> = new Set()): EndpointState | undefined {
    const candidates = [...this.endpoints.values()].filter(
      (s) => isAvailable(s, this.policy, Date.now(), (e) => this.emitCircuit(e)) && !exclude.has(s.spec.name),
    );
    return pickByStrategy(this.policy.strategy, candidates);
  }

  /** Execute `fn` against an endpoint, with failover + circuit breaker + retry. */
  async call<T>(fn: (endpoint: EndpointSpec) => Promise<T>): Promise<T> {
    const tried = new Set<string>();
    let lastErr: Error | undefined;

    while (tried.size < this.endpoints.size) {
      const ep = this.pickEndpoint(tried);
      if (!ep) break;
      tried.add(ep.spec.name);

      for (let attempt = 0; attempt < this.policy.maxRetriesPerEndpoint; attempt++) {
        const start = Date.now();
        try {
          const result = await fn(ep.spec);
          recordSuccess(ep, Date.now() - start, (e) => this.emitCircuit(e));
          return result;
        } catch (err: any) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          recordFailure(ep, this.policy, lastErr, (e) => this.emitCircuit(e), start);
          logger.warn("mesh.endpoint_failed", {
            endpoint: ep.spec.name,
            attempt: attempt + 1,
            error: lastErr.message,
          });
        }
      }
      // If we got here, all retries on this endpoint failed; try next.
    }

    throw lastErr ?? new Error("provider mesh: all endpoints failed");
  }

  /** Start periodic health checks for endpoints that have a healthCheckUrl. */
  startHealthChecks(): void {
    this.health.start();
  }

  stopHealthChecks(): void {
    this.health.stop();
  }

  /** Bridge `circuit-change` EventEmitter events to the
   *  `CircuitChangeEvent` payload shape consumers expect. */
  private emitCircuit(event: CircuitChangeEvent): void {
    this.emit("circuit-change", event);
  }
}

/** Build a ProviderMesh from a list of endpoint specs and start its
 *  health-check loop. Convenience wrapper used by `buildDefaultPhusAgentDeps`. */
export function buildMesh(
  endpoints: EndpointSpec[],
  policy: MeshPolicy = {},
): ProviderMesh {
  if (endpoints.length === 0) {
    throw new Error("ProviderMesh requires at least one endpoint");
  }
  const mesh = new ProviderMesh(endpoints, policy);
  mesh.startHealthChecks();
  return mesh;
}