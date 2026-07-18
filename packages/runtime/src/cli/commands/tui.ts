// src/cli/commands/tui.ts
// `phus tui` — launch the interactive ink-based TUI.

import type { Command } from "commander";

export function registerTuiCommand(program: Command): void {
  program
    .command("tui")
    .description("Launch the interactive ink-based TUI")
    .action(async () => {
      const { startTui } = await import("@phus/tui");
      await startTui();
    });
}