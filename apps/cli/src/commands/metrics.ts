// src/cli/commands/metrics.ts
// `phus metrics [--session <id>] [--json]` — print aggregated intelligence-loop stats.

import type { Command } from "commander";
import * as path from "node:path";
import { loadConfig } from "@phus/runtime/infra/config/loader.js";
import { printMetrics } from "@phus/runtime/commands/metrics.js";

export function registerMetricsCommand(program: Command): void {
    program
        .command("metrics")
        .description("Print aggregated plan / reflection / skill-draft metrics")
        .option("--session <id>", "Filter by session id")
        .option("--json", "Output JSON instead of human-readable text")
        .action(async (opts: { session?: string; json?: boolean }) => {
            const config = await loadConfig();
            const tapePath = path.resolve(config.paths.tapeDb ?? "./tape.sqlite");
            printMetrics(tapePath, {
                sessionId: opts.session,
                json: opts.json === true,
            });
        });
}