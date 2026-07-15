// src/core/provider-mesh-runtime.ts
// Singleton for the runtime ProviderMesh, so `,mesh` command can read its stats.

import { ProviderMesh, type MeshPolicy } from "@/core/provider-mesh.js";
import { logger } from "@/core/logger.js";

let instance: ProviderMesh | undefined;

export function setMesh(mesh: ProviderMesh): void {
  instance = mesh;
}

export function getActiveMesh(): ProviderMesh | undefined {
  return instance;
}

export function clearMesh(): void {
  if (instance) instance.stopHealthChecks();
  instance = undefined;
}

/** Build a ProviderMesh from a list of endpoint specs. */
export function buildMesh(
  endpoints: Array<{
    name: string;
    provider: string;
    modelId: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    priority?: number;
    weight?: number;
    costPerMillion?: { input: number; output: number };
    tags?: string[];
  }>,
  policy: MeshPolicy = {},
): ProviderMesh {
  if (endpoints.length === 0) {
    throw new Error("ProviderMesh requires at least one endpoint");
  }
  const mesh = new ProviderMesh(endpoints, policy);
  mesh.startHealthChecks();
  logger.info("mesh.started", {
    endpoints: endpoints.length,
    strategy: policy.strategy ?? "failover",
  });
  return mesh;
}
