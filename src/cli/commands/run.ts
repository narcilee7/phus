// src/cli/commands/run.ts
// `phus run <prompt>` — one-shot prompt + print response.

import type { Command } from "commander";
import { loadConfig, resetConfigCache } from "@/infra/config/index.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run <prompt>")
    .description("Run a single prompt and print the response")
    .option("-p, --profile <name>", "Use a specific provider profile (overrides PHUS_PROFILE)")
    .action(async (prompt: string, opts: { profile?: string }) => {
      if (opts.profile) {
        // Override PHUS_PROFILE for this run only and force a config
        // reload so the agent picks up the new profile.
        process.env.PHUS_PROFILE = opts.profile;
        resetConfigCache();
      }
      const { runOnce } = await import("@/channels/cli.js");
      await runOnce(prompt, opts.profile ?? loadConfig().profileName);
    });
}