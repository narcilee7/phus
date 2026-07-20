// src/core/provider-mesh/types.ts
// Domain types for the provider mesh. Pure — no runtime deps.

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

/** Mutable runtime state for one endpoint. */
export interface EndpointState {
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