// src/cli/commands/run.ts
// `phus run <prompt>` — one-shot prompt + print response.

import type { Command } from "commander";

export function registerRunCommand(program: Command): void {
  program
    .command("run <prompt>")
    .description("Run a single prompt and print the response")
    .option("-p, --profile <name>", "Use a specific provider profile (overrides PHUS_PROFILE)")
    .action(async (prompt: string, opts: { profile?: string }) => {
      if (opts.profile) process.env.PHUS_PROFILE = opts.profile;
      const { runOnce } = await import("@/channels/cli.js");
      await runOnce(prompt);
    });
}