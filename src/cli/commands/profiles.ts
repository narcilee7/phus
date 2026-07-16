// src/cli/commands/profiles.ts
// `phus profiles` — list configured provider profiles.

import type { Command } from "commander";
import { loadConfig } from "@/infra/config/index.js";

export function registerProfilesCommand(program: Command): void {
  program
    .command("profiles")
    .description("List configured provider profiles")
    .action(async () => {
      const { formatProfiles } = await import("@/infra/profile.js");
      console.log(formatProfiles());
      const active = loadConfig().profileName;
      console.log(`\nactive: ${active}`);
      console.log(`set:    PHUS_PROFILE=<name>  or  phus run --profile <name> "..."`);
    });
}