// src/cli/commands/chat.ts
// `phus chat` — launch the TUI.

import type { Command } from "commander";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Launch the interactive TUI")
    .action(async () => {
      const { startTui } = await import("@phus/tui");
      await startTui();
    });
}