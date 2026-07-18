// src/cli/commands/hooks.ts
// `phus hooks` — print the registered hook report.

import type { Command } from "commander";
import { PhusAgent } from "@/bridge/pi-agent.js";

export function registerHooksCommand(program: Command): void {
  program
    .command("hooks")
    .description("List all registered hooks (diagnostic)")
    .action(async () => {
      const handle = await PhusAgent.create();
      console.log(JSON.stringify(handle.agent.getHookReport(), null, 2));
      await handle.dispose();
    });
}