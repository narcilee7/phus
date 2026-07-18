// src/cli/commands/tape.ts
// `phus tape` — print tape statistics.

import type { Command } from "commander";
import { PhusAgent } from "@/bridge/pi-agent.js";

export function registerTapeCommand(program: Command): void {
  program
    .command("tape")
    .description("Print tape statistics")
    .action(async () => {
      const handle = await PhusAgent.create();
      console.log(JSON.stringify(handle.agent.getTapeStats(), null, 2));
      await handle.dispose();
    });
}