// src/cli/commands/policy.ts
// `phus policy` — show the active safety policy.

import type { Command } from "commander";
import { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";

export function registerPolicyCommand(program: Command): void {
  program
    .command("policy")
    .description("Print active safety policy (operator-equivalence allowlist)")
    .action(async () => {
      const handle = await PhusAgent.create();
      console.log("Active policy rules:");
      for (const rule of handle.agent.getPolicy()) {
        console.log(`  - tool: ${rule.toolName}`);
      }
      console.log("\nDefault file_write roots: ./skills, ./.phus, ./tmp, ./out");
      console.log("Default bash blocklist: rm -rf /, fork bombs, curl|sh, dd if=, chmod -R 777 /, mkfs");
      await handle.dispose();
    });
}