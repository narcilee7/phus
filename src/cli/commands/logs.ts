// src/cli/commands/logs.ts
// `phus logs` — query the structured JSON log file.

import type { Command } from "commander";
import { tailLogs } from "@/commands/logs.js";

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("Query the structured JSON log")
    .option("-f, --follow", "Stream new log lines as they arrive")
    .option("-s, --session <sessionId>", "Filter to one session")
    .option("-l, --level <level>", "Minimum log level (fatal/error/warn/info/debug/trace)", "info")
    .option("-e, --event <event>", "Filter to one event name")
    .option("-n, --limit <n>", "Show last N entries (no -f)", "50")
    .option("--json", "Emit raw JSON lines")
    .action(async (opts: { follow?: boolean; session?: string; level: string; event?: string; limit: string; json?: boolean }) => {
      const file = process.env.PHUS_LOG_FILE ?? "./logs/phus.jsonl";
      await tailLogs(file, {
        follow: opts.follow,
        session: opts.session,
        level: opts.level as any,
        event: opts.event,
        limit: parseInt(opts.limit, 10),
        json: opts.json,
      });
    });
}