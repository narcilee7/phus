// src/cli/commands/skill-create.ts
// `phus skill create <name>` — scaffold a new SKILL.md in the skills dir.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { loadConfig } from "@phus/runtime/infra/config/index.js";

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: <one-line description of what this skill does>
author: user
version: 1.0.0
trigger: when <describe when the agent should use this skill>
---

# ${name}

<Write the skill body here. This is a prompt guide the agent reads when the skill is active.>
`;
}

export function registerSkillCreateCommand(program: Command): void {
  program
    .command("skill:create <name>")
    .alias("skill create")
    .description("Create a new skill scaffold in the skills directory")
    .action(async (name: string) => {
      const kebab = toKebabCase(name);
      if (!kebab) {
        console.error("Invalid skill name");
        process.exit(1);
      }

      const config = loadConfig();
      const skillsDir = config.paths.skillsDir;
      const skillDir = path.join(skillsDir, kebab);
      const skillFile = path.join(skillDir, "SKILL.md");

      if (fs.existsSync(skillFile)) {
        console.error(`Skill already exists: ${skillFile}`);
        process.exit(1);
      }

      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillFile, skillTemplate(kebab), "utf-8");
      console.log(`Created skill scaffold at ${skillFile}`);
      console.log(`Edit the file, then run \`phus skills\` to see it listed.`);
    });
}
