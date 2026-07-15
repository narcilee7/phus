// src/cli/commands/profiles.ts
// `phus profiles` — list configured provider profiles.

import type { Command } from "commander";

export function registerProfilesCommand(program: Command): void {
  program
    .command("profiles")
    .description("List configured provider profiles")
    .action(async () => {
      const { formatProfiles } = await import("@/infra/profile.js");
      console.log(formatProfiles());
      console.log(`\nactive: ${process.env.PHUS_PROFILE ?? "(default)"}`);
      console.log(`set:    PHUS_PROFILE=<name>  or  phus run --profile <name> "..."`);
    });
}