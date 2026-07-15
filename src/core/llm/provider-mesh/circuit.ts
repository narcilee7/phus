// src/core/provider-mesh/circuit.ts
// Circuit breaker bookkeeping. Pure mutations on EndpointState; the
// caller passes an `emit` callback so this module does not depend
// on EventEmitter.

import { logger } from "@/infra/logging.js";
import type { EndpointState, MeshPolicy } from "./types.js";

/** Event payload emitted whenever an endpoint's circuit state changes. */
export interface CircuitChangeEvent {
  name: string;
  state: EndpointState["circuit"];
}

/** Decide whether an endpoint can receive traffic right now.
 *  Side effect: if the circuit is `open` and the cooldown has elapsed,
 *  transitions it to `half-open` and emits. */
export function isAvailable(
  ep: EndpointState,
  policy: MeshPolicy,
  now: number,
  emit?: (event: CircuitChangeEvent) => void,
): boolean {
  if (ep.circuit === "closed" || ep.circuit === "half-open") return true;
  // open
  if (ep.openedAt !== undefined && now - ep.openedAt >= (policy.cbCooldownMs ?? 0)) {
    ep.circuit = "half-open";
    logger.info("mesh.circuit_half_open", { endpoint: ep.spec.name });
    emit?.({ name: ep.spec.name, state: "half-open" });
    return true;
  }
  return false;
}

/** Record a successful call. Slides latency window and resets the
 *  circuit if it was open or half-open. */
export function recordSuccess(
  ep: EndpointState,
  latencyMs: number,
  emit?: (event: CircuitChangeEvent) => void,
): void {
  ep.totalSuccess++;
  ep.consecutiveFailures = 0;
  ep.lastLatencyMs = latencyMs;
  ep.latencies.push(latencyMs);
  if (ep.latencies.length > 20) ep.latencies.shift();
  if (ep.circuit === "half-open" || ep.circuit === "open") {
    ep.circuit = "closed";
    logger.info("mesh.circuit_closed", { endpoint: ep.spec.name });
    emit?.({ name: ep.spec.name, state: "closed" });
  }
}

/** Record a failed call. Opens the circuit if the threshold is reached.
 *  `_err` is intentionally unused but kept in the signature for
 *  logging parity with the previous monolithic API. `now` defaults
 *  to `Date.now()`; pass an explicit value when testing against a
 *  fixed reference clock. */
export function recordFailure(
  ep: EndpointState,
  policy: MeshPolicy,
  _err: Error,
  emit?: (event: CircuitChangeEvent) => void,
  now: number = Date.now(),
): void {
  ep.totalFailure++;
  ep.consecutiveFailures++;
  if (
    ep.circuit === "closed" &&
    ep.consecutiveFailures >= (policy.cbFailureThreshold ?? Number.POSITIVE_INFINITY)
  ) {
    ep.circuit = "open";
    ep.openedAt = now;
    logger.warn("mesh.circuit_opened", {
      endpoint: ep.spec.name,
      failures: ep.consecutiveFailures,
    });
    emit?.({ name: ep.spec.name, state: "open" });
  }
}