// src/cli/commands/health.ts
// `phus health` — Docker HEALTHCHECK / systemd watchdog target.
// Exits 0 if healthy, non-zero otherwise.

import type { Command } from "commander";
import { healthCheck } from "@/commands/health.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Health check (exit 0 if healthy)")
    .option("--json", "Emit JSON")
    .action((opts: { json?: boolean }) => {
      const status = healthCheck();
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        for (const [k, v] of Object.entries(status.checks)) {
          console.log(`${v.ok ? "✅" : "❌"} ${k}: ${v.detail ?? ""}`);
        }
      }
      process.exit(status.ok ? 0 : 1);
    });
}