// src/cli/commands/skills.ts
// `phus skills` — list all discovered skills.

import type { Command } from "commander";
import { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";

export function registerSkillsCommand(program: Command): void {
  program
    .command("skills")
    .description("List all discovered skills")
    .action(async () => {
      const handle = await PhusAgent.create();
      for (const skill of handle.agent.getAllSkills()) {
        console.log(`- ${skill.name} (v${skill.metadata.version ?? "?"}, by ${skill.metadata.author ?? "?"})`);
        console.log(`  ${skill.description}`);
        console.log(`  ${skill.location}`);
      }
      await handle.dispose();
    });
}