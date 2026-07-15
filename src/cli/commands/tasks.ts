// src/cli/commands/tasks.ts
// `phus tasks` — show agent state, sessions, schedules, recent checkpoints.

import type { Command } from "commander";
import { collectTasks, renderTasks } from "@/commands/tasks.js";

export function registerTasksCommand(program: Command): void {
  program
    .command("tasks")
    .description("Show agent state, sessions, schedules, and recent checkpoints")
    .option("--json", "emit JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = await collectTasks();
      if (opts.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(renderTasks(out));
      }
    });
}