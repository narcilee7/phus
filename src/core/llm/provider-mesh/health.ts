// src/core/provider-mesh/health.ts
// Periodic health checks. Lifecycle (start/stop) lives here; the
// per-endpoint ping is a pure `pingHealth()` exported for tests.

import { logger } from "@/core/logger.js";
import type { EndpointState, MeshPolicy } from "./types.js";

/** Perform one HTTP HEAD against `url` with a hard timeout.
 *  Returns false on any error or 5xx response. */
export async function pingHealth(url: string, timeoutMs: number): Promise<boolean> {
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

/** Run a single health-check pass across the supplied states.
 *  Updates `lastHealthCheck` and nudges circuit state — a healthy
 *  endpoint with an open/half-open circuit moves to half-open; an
 *  unhealthy endpoint in `closed` accumulates a failure. */
export async function runHealthChecks(
  states: Iterable<EndpointState>,
  policy: MeshPolicy,
): Promise<void> {
  for (const ep of states) {
    if (!ep.spec.healthCheckUrl) continue;
    const ok = await pingHealth(
      ep.spec.healthCheckUrl,
      policy.healthCheckTimeoutMs ?? 5_000,
    );
    ep.lastHealthCheck = { ok, ts: Date.now() };
    if (ok) {
      if (ep.circuit === "open" || ep.circuit === "half-open") {
        ep.circuit = "half-open";
        logger.info("mesh.circuit_half_open_via_healthcheck", {
          endpoint: ep.spec.name,
        });
      }
    } else {
      if (ep.circuit === "closed") {
        ep.consecutiveFailures++;
      }
    }
  }
}

export interface HealthTimer {
  /** Start (or restart) the periodic health check loop. Idempotent. */
  start(): void;
  /** Stop the loop and clear the underlying timer. Idempotent. */
  stop(): void;
  /** True iff the loop is currently running. */
  isRunning(): boolean;
}

/** Build a HealthTimer bound to a specific set of states + policy.
 *  Returns a plain object so it can be composed into the ProviderMesh
 *  class without inheritance gymnastics. */
export function createHealthTimer(
  states: Iterable<EndpointState>,
  policy: MeshPolicy,
): HealthTimer {
  let timer: NodeJS.Timeout | undefined;
  return {
    start() {
      if (timer) return;
      timer = setInterval(
        () => {
          void runHealthChecks(states, policy);
        },
        policy.healthCheckIntervalMs ?? 30_000,
      );
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    isRunning() {
      return timer !== undefined;
    },
  };
}