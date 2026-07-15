#!/usr/bin/env node
// src/phus.ts
// Composition root. Builds the Commander program, drains the plugin
// CLI command queue, then parses argv. All real command logic lives
// in `src/cli/commands/`.

import { buildProgram, registerPluginCliCommands } from "@/cli/program.js";

const program = buildProgram();

await registerPluginCliCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error("[phus] fatal:", err);
  process.exit(1);
});