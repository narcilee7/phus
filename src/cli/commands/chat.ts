// src/cli/commands/chat.ts
// `phus chat` — alias for the TUI.

import type { Command } from "commander";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Alias for `phus tui` — launch the interactive TUI")
    .action(async () => {
      const { startTui } = await import("@/tui/index.js");
      await startTui();
    });
}