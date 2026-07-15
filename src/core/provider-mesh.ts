// src/core/provider-mesh.ts
// Runtime provider mesh — multiple endpoints per profile, with health
// checks, circuit breaker, and policy-based routing (failover / weighted /
// cost-first / latency-first).
//
// All decisions are made IN-PROCESS by Phus. No external proxy required.

import { EventEmitter } from "node:events";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { logger } from "@/core/logger.js";

export interface EndpointSpec {
  name: string;
  /** Pi provider name (e.g. "openai", "anthropic", "deepseek"). */
  provider: string;
  /** Pi modelId OR override id sent on the wire. */
  modelId: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  /** Priority for failover. Lower = tried first. Default: 0. */
  priority?: number;
  /** Weight for weighted strategy. Default: 1. */
  weight?: number;
  /** Cost per 1M tokens (USD). Default: 0 (unknown). */
  costPerMillion?: { input: number; output: number };
  /** Tags for cost/latency-aware routing (e.g. "premium", "cheap", "china"). */
  tags?: string[];
  /** Optional health check URL. */
  healthCheckUrl?: string;
}

export type RoutingStrategy = "failover" | "weighted" | "cost-first" | "latency-first";

export interface MeshPolicy {
  /** Routing strategy. Default: "failover" */
  strategy?: RoutingStrategy;
  /** Per-endpoint retries before failover. Default: 2. */
  maxRetriesPerEndpoint?: number;
  /** Circuit breaker: fail count to open. Default: 5. */
  cbFailureThreshold?: number;
  /** Circuit breaker: how long to keep open. Default: 60_000 ms. */
  cbCooldownMs?: number;
  /** Health check interval. Default: 30_000 ms. */
  healthCheckIntervalMs?: number;
  /** Health check timeout. Default: 5000 ms. */
  healthCheckTimeoutMs?: number;
}

export const DEFAULT_MESH_POLICY: Required<MeshPolicy> = {
  strategy: "failover",
  maxRetriesPerEndpoint: 2,
  cbFailureThreshold: 5,
  cbCooldownMs: 60_000,
  healthCheckIntervalMs: 30_000,
  healthCheckTimeoutMs: 5_000,
};

export type CircuitState = "closed" | "open" | "half-open";

interface EndpointState {
  spec: EndpointSpec;
  circuit: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  lastLatencyMs?: number;
  /** Sliding window of recent latencies (last 20) for p50/p95. */
  latencies: number[];
  /** Cumulative success/failure counts since startup. */
  totalSuccess: number;
  totalFailure: number;
  /** Last health check result. */
  lastHealthCheck?: { ok: boolean; ts: number };
}

/** Builds a Pi-compatible Model from an endpoint spec, applying overrides. */
export function endpointToModel(ep: EndpointSpec): Model<any> {
  const base = getModel(ep.provider as any, ep.modelId as any);
  const overrides: Partial<Model<any>> = {};
  if (ep.baseUrl) overrides.baseUrl = ep.baseUrl;
  if (ep.modelId) overrides.id = ep.modelId;
  return Object.keys(overrides).length > 0 ? { ...base, ...overrides } : base;
}

export class ProviderMesh extends EventEmitter {
  private endpoints = new Map<string, EndpointState>();
  private readonly policy: Required<MeshPolicy>;
  private healthTimer: NodeJS.Timeout | undefined;

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
  stats(): {
    endpoints: Array<{
      name: string;
      circuit: CircuitState;
      totalSuccess: number;
      totalFailure: number;
      avgLatencyMs?: number;
      p95LatencyMs?: number;
      lastHealthOk?: boolean;
    }>;
  } {
    const endpoints = [...this.endpoints.values()].map((s) => ({
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

  /** Pick an endpoint according to the routing strategy.
   *  Skips endpoints with open circuits and any in `exclude` set.
   *  Returns undefined if all unhealthy. */
  pickEndpoint(exclude: Set<string> = new Set()): EndpointState | undefined {
    const candidates = [...this.endpoints.values()].filter(
      (s) => this.isAvailable(s) && !exclude.has(s.spec.name),
    );
    if (candidates.length === 0) return undefined;

    switch (this.policy.strategy) {
      case "failover":
        return [...candidates].sort((a, b) => (a.spec.priority ?? 0) - (b.spec.priority ?? 0))[0];

      case "weighted": {
        const totalWeight = candidates.reduce((sum, s) => sum + (s.spec.weight ?? 1), 0);
        let r = Math.random() * totalWeight;
        for (const s of candidates) {
          r -= s.spec.weight ?? 1;
          if (r <= 0) return s;
        }
        return candidates[candidates.length - 1];
      }

      case "cost-first":
        return [...candidates].sort((a, b) => {
          const aCost = (a.spec.costPerMillion?.input ?? Infinity) + (a.spec.costPerMillion?.output ?? Infinity);
          const bCost = (b.spec.costPerMillion?.input ?? Infinity) + (b.spec.costPerMillion?.output ?? Infinity);
          return aCost - bCost;
        })[0];

      case "latency-first":
        return [...candidates].sort((a, b) => {
          const aLat = avg(a.latencies) ?? Infinity;
          const bLat = avg(b.latencies) ?? Infinity;
          return aLat - bLat;
        })[0];
    }
  }

  /** Execute `fn` against an endpoint, with failover + circuit breaker + retry. */
  async call<T>(fn: (endpoint: EndpointSpec) => Promise<T>): Promise<T> {
    const tried = new Set<string>();
    let lastErr: Error | undefined;

    while (tried.size < this.endpoints.size) {
      const ep = this.pickEndpoint(tried);
      if (!ep) break;
      tried.add(ep.spec.name);

      // Try this endpoint up to maxRetriesPerEndpoint times
      let succeeded = false;
      for (let attempt = 0; attempt < this.policy.maxRetriesPerEndpoint; attempt++) {
        const start = Date.now();
        try {
          const result = await fn(ep.spec);
          this.recordSuccess(ep, Date.now() - start);
          return result;
        } catch (err: any) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          this.recordFailure(ep, lastErr);
          logger.warn("mesh.endpoint_failed", {
            endpoint: ep.spec.name,
            attempt: attempt + 1,
            error: lastErr.message,
          });
        }
      }
      void succeeded; // suppression
      // If we got here, all retries on this endpoint failed; try next
    }

    throw lastErr ?? new Error("provider mesh: all endpoints failed");
  }

  /** Record a successful call. Updates circuit + latency. */
  recordSuccess(ep: EndpointState, latencyMs: number): void {
    ep.totalSuccess++;
    ep.consecutiveFailures = 0;
    ep.lastLatencyMs = latencyMs;
    ep.latencies.push(latencyMs);
    if (ep.latencies.length > 20) ep.latencies.shift();
    if (ep.circuit === "half-open" || ep.circuit === "open") {
      ep.circuit = "closed";
      logger.info("mesh.circuit_closed", { endpoint: ep.spec.name });
      this.emit("circuit-change", { name: ep.spec.name, state: "closed" });
    }
  }

  /** Record a failed call. Opens circuit if threshold exceeded. */
  recordFailure(ep: EndpointState, _err: Error): void {
    ep.totalFailure++;
    ep.consecutiveFailures++;
    if (
      ep.circuit === "closed" &&
      ep.consecutiveFailures >= this.policy.cbFailureThreshold
    ) {
      ep.circuit = "open";
      ep.openedAt = Date.now();
      logger.warn("mesh.circuit_opened", {
        endpoint: ep.spec.name,
        failures: ep.consecutiveFailures,
      });
      this.emit("circuit-change", { name: ep.spec.name, state: "open" });
    }
  }

  /** Check if endpoint is currently usable (circuit closed or half-open expired). */
  private isAvailable(ep: EndpointState): boolean {
    if (ep.circuit === "closed") return true;
    if (ep.circuit === "half-open") return true;
    // open: check if cooldown has elapsed
    if (ep.circuit === "open" && ep.openedAt) {
      if (Date.now() - ep.openedAt >= this.policy.cbCooldownMs) {
        ep.circuit = "half-open";
        logger.info("mesh.circuit_half_open", { endpoint: ep.spec.name });
        this.emit("circuit-change", { name: ep.spec.name, state: "half-open" });
        return true;
      }
    }
    return false;
  }

  /** Start periodic health checks for endpoints that have a healthCheckUrl. */
  startHealthChecks(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => this.runHealthChecks(), this.policy.healthCheckIntervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const ep of this.endpoints.values()) {
      if (!ep.spec.healthCheckUrl) continue;
      const ok = await pingHealth(ep.spec.healthCheckUrl, this.policy.healthCheckTimeoutMs);
      ep.lastHealthCheck = { ok, ts: Date.now() };
      if (ok) {
        if (ep.circuit === "open" || ep.circuit === "half-open") {
          ep.circuit = "half-open";
        }
      } else {
        if (ep.circuit === "closed") {
          ep.consecutiveFailures++;
        }
      }
    }
  }
}

function avg(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr: number[], p: number): number | undefined {
  if (arr.length === 0) return undefined;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pingHealth(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}
