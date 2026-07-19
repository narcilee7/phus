// src/cli/commands/resume.ts
// `phus resume <sessionId> [prompt]` — restore from latest checkpoint.

import type { Command } from "commander";
import { resumeSession } from "@phus/runtime/commands/resume.js";
import { ExitCode, CliExit } from "@phus/runtime/core/runtime/executor/exit-code.js";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume <sessionId> [prompt]")
    .description("Resume a session from its latest checkpoint (B.2.3)")
    .action(async (sessionId: string, prompt?: string) => {
      try {
        await resumeSession(sessionId, prompt ?? "");
      } catch (err) {
        if (err instanceof CliExit) {
          console.error(`[phus] ${err.message}`);
          process.exit(err.code);
        }
        if (err instanceof Error) {
          console.error(`[phus] ${err.message}`);
        }
        throw err;
      }
    });
}
