// src/cli/commands/trace.ts
// `phus trace <sessionId>` — print a turn timeline for one session.

import type { Command } from "commander";
import { traceSession } from "@/commands/trace.js";

export function registerTraceCommand(program: Command): void {
  program
    .command("trace <sessionId>")
    .description("Print a turn timeline for one session")
    .option("-l, --limit <n>", "Max entries to show", "50")
    .option("-k, --kind <kind>", "Filter: turn | tool_call | tool_result | error | anchor")
    .option("--json", "Emit raw JSON instead of human-readable")
    .action((sessionId: string, opts: { limit: string; kind?: string; json?: boolean }) => {
      const dbPath = process.env.PHUS_TAPE_DB ?? "./tape.sqlite";
      traceSession(dbPath, sessionId, {
        limit: parseInt(opts.limit, 10),
        kind: opts.kind as any,
        json: opts.json,
      });
    });
}