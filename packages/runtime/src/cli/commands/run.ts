// src/cli/commands/run.ts
// `phus run <prompt>` — one-shot prompt + print response.

import type { Command } from "commander";
import { loadConfig, resetConfigCache } from "@/infra/config/index.js";
import { resolveProfile, apiKeyForProfile } from "@/infra/profile.js";

function formatMissingKeyError(profileName: string): string {
  const profile = resolveProfile(profileName, loadConfig().providers);
  const envVar = profile.apiKeyEnv
    ? profile.apiKeyEnv
    : `${profile.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  return (
    `No API key configured for profile "${profileName}".\n` +
    `Run \`phus setup\` to configure a provider and key, or set:\n` +
    `  export ${envVar}=<your-key>`
  );
}

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

      const profileName = opts.profile ?? loadConfig().profileName;
      const profile = resolveProfile(profileName, loadConfig().providers);
      if (!apiKeyForProfile(profile)) {
        // eslint-disable-next-line no-console
        console.error(formatMissingKeyError(profileName));
        process.exit(1);
      }

      try {
        const { runOnce } = await import("@/channels/cli.js");
        await runOnce(prompt, profileName);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(err?.message ?? String(err));
        process.exit(1);
      }
    });
}
