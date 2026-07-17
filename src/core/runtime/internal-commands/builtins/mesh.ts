// src/core/internal-commands/builtins/mesh.ts
// ,mesh — runtime provider-mesh status (endpoints, circuits, stats).

import type { InternalCommand, InternalCommandServices } from "../types";

export function defineMeshCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "mesh",
      description: "show runtime provider mesh status (endpoints, circuits, stats)",
      handler: async () => {
        const mesh = services.mesh;
        if (!mesh) return "(no active mesh — set profile.mesh in phus.config.yaml)";
        const stats = mesh.stats();
        const lines: string[] = [];
        lines.push(`endpoints: ${stats.endpoints.length}`);
        for (const e of stats.endpoints) {
          const mark = e.circuit === "closed" ? "●" : e.circuit === "half-open" ? "◐" : "○";
          const avg = e.avgLatencyMs ? `${e.avgLatencyMs.toFixed(0)}ms` : "-";
          lines.push(
            `  ${mark} ${e.name.padEnd(20)} ${e.circuit.padEnd(10)} ok=${e.totalSuccess} fail=${e.totalFailure} avg=${avg}`,
          );
        }
        return lines.join("\n");
      },
    },
  ];
}
