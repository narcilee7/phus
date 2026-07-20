// src/core/provider-mesh/contract.ts
// Narrow Mesh contract used by Phase 4 dependency injection.
//
// The concrete `ProviderMesh` in `index.ts` implements this interface
// structurally. Tests and downstream code can depend on `MeshLike`
// without pulling in EventEmitter / Node timer dependencies.

import type { CircuitState, EndpointSpec, EndpointState } from "./types.js";
import type { MeshStats } from "./stats.js";

export interface MeshLike {
  /** Pick an endpoint per the configured routing strategy.
   *  Returns `undefined` if every endpoint is excluded or unavailable. */
  pickEndpoint(exclude?: ReadonlySet<string>): EndpointState | undefined;
  /** Execute `fn` against the best endpoint, with failover + retries. */
  call<T>(fn: (endpoint: EndpointSpec) => Promise<T>): Promise<T>;
  /** Snapshot of every endpoint's aggregate state. */
  stats(): MeshStats;
  /** All endpoint specs known to this mesh (insertion order). */
  listEndpoints(): readonly EndpointSpec[];
  /** Start the periodic health-check loop. */
  startHealthChecks(): void;
  /** Stop the periodic health-check loop. Idempotent. */
  stopHealthChecks(): void;
  /** Read the runtime state for one endpoint. */
  getEndpoint(name: string): EndpointState | undefined;
}

/** Re-export the common types so downstream consumers only need one
 *  import path for the mesh contract surface. */
export type { CircuitState, EndpointSpec, EndpointState, MeshStats };