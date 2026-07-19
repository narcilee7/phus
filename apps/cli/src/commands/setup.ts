// src/cli/commands/setup.ts
// `phus setup` — run the interactive first-run wizard.

import type { Command } from "commander";
import { loadConfig } from "@phus/runtime/infra/config/index.js";
import { runSetupWizard } from "@phus/runtime/infra/bootstrap/wizard.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard for Phus")
    .action(async () => {
      const config = loadConfig({ forceReload: true });
      await runSetupWizard({ config, writeConfig: async () => {} });
    });
}
