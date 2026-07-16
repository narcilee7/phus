#!/usr/bin/env node
// src/phus.ts
// Composition root. Resolves config, initializes the logger, builds
// the Commander program, drains the plugin CLI command queue, then
// parses argv. All real command logic lives in `src/cli/commands/`.

import { loadConfig, setLogSink } from "@/infra/config/index.js";
import { initLogger, logger } from "@/infra/logging.js";
import { buildProgram, registerPluginCliCommands } from "@/cli/program.js";

// 1. Resolve config BEFORE building the program so plugins and any
//    diagnostic logs they emit see substituted config + active level.
const config = loadConfig({ warn: (event, fields) => logger.warn(event, fields) });
setLogSink((event, fields) => logger.warn(event, fields));

// 2. Initialize the logger against the resolved file/level. Env still
//    wins inside loadConfig for PHUS_LOG_LEVEL / PHUS_LOG_FILE.
initLogger({ file: config.log.file, level: config.log.level });

const program = buildProgram();

await registerPluginCliCommands(program, config);

program.parseAsync(process.argv).catch((err) => {
  console.error("[phus] fatal:", err);
  process.exit(1);
});