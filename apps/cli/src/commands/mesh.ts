// src/cli/commands/mesh.ts
// `phus mesh` — print runtime provider mesh status.

import type { Command } from "commander";
import { loadConfig } from "@phus/runtime/infra/config/index.js";
import { buildMesh } from "@phus/runtime/llm/provider-mesh/index.js";
import type { EndpointSpec, MeshPolicy } from "@phus/runtime/llm/provider-mesh/index.js";

export function registerMeshCommand(program: Command): void {
  program
    .command("mesh")
    .description("Show runtime provider mesh status (endpoints, circuits, stats)")
    .action(async () => {
      const config = loadConfig();
      const profile = config.providers.profiles[config.profileName];
      if (!profile) {
        console.error(`Unknown profile: ${config.profileName}`);
        process.exit(1);
      }

      const endpoints: EndpointSpec[] = profile.mesh && profile.mesh.length > 0
        ? profile.mesh.map((m) => ({
            name: m.name,
            provider: m.provider,
            modelId: m.modelId,
            baseUrl: m.baseUrl,
            apiKeyEnv: m.apiKeyEnv,
            priority: m.priority,
            weight: m.weight,
            costPerMillion: m.costPerMillion,
            tags: m.tags,
          }))
        : [{
            name: profile.name,
            provider: profile.provider,
            modelId: profile.modelId,
            baseUrl: profile.baseUrl,
            apiKeyEnv: profile.apiKeyEnv,
            priority: 0,
          }];

      const policy: MeshPolicy = { strategy: profile.meshStrategy ?? "failover" };
      const mesh = buildMesh(endpoints, policy);
      const stats = mesh.stats();

      console.log(`profile: ${profile.name}`);
      console.log(`strategy: ${policy.strategy}`);
      console.log(`endpoints: ${stats.endpoints.length}`);
      for (const e of stats.endpoints) {
        const mark = e.circuit === "closed" ? "●" : e.circuit === "half-open" ? "◐" : "○";
        const avg = e.avgLatencyMs ? `${e.avgLatencyMs.toFixed(0)}ms` : "-";
        const p95 = e.p95LatencyMs ? `${e.p95LatencyMs.toFixed(0)}ms` : "-";
        const health = e.lastHealthOk === true ? "ok" : e.lastHealthOk === false ? "fail" : "-";
        console.log(
          `  ${mark} ${e.name.padEnd(20)} ${e.circuit.padEnd(10)} ok=${e.totalSuccess} fail=${e.totalFailure} avg=${avg} p95=${p95} health=${health}`,
        );
      }
    });
}
