// src/cli/commands/default.ts
// Default action (no subcommand) — launch the TUI.

import type { Command } from "commander";

export function registerDefaultCommand(program: Command): void {
  program.action(async () => {
    const { startTui } = await import("@/tui/index.js");
    await startTui();
  });
}