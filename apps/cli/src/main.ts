#!/usr/bin/env node
// src/phus.ts
// Composition root. Resolves config, initializes the logger, builds
// the Commander program, drains the plugin CLI command queue, then
// parses argv. All real command logic lives in `src/cli/commands/`.

import { loadConfig, setLogSink } from "@phus/runtime/infra/config/index.js";
import { loadEnvFile } from "@phus/runtime/infra/env-file.js";
import { initLogger, logger } from "@phus/runtime/infra/logging.js";
import { buildProgram, registerPluginCliCommands } from "./program.js";

// 0. Load optional `$PHUS_HOME/.env` so API keys and other secrets are
//    available before config interpolation and model resolution run.
loadEnvFile();

// 1. Resolve config BEFORE building the program so plugins and any
//    diagnostic logs they emit see substituted config + active level.
const config = loadConfig({ warn: (event, fields) => logger.warn(event, fields) });
setLogSink((event, fields) => logger.warn(event, fields));

// 2. Initialize the logger against the resolved file/level. Env still
//    wins inside loadConfig for PHUS_LOG_LEVEL / PHUS_LOG_FILE.
initLogger({ file: config.log.file, level: config.log.level });

const program = buildProgram();

await registerPluginCliCommands(program, config);

// Argument model (proposal §4.2):
//   phus                     → startTui() (lazy-imported)
//   phus <known-command>     → commander dispatches
//   phus --option / flags    → commander handles (e.g. --help, --version)
//   phus <unknown-command>   → usage error, exit 2
// We pick the branch ourselves so `phus tui` (an unknown subcommand) is
// rejected explicitly rather than silently falling through to the TUI.
const argv = process.argv.slice(2);
const knownCommand =
	argv.length > 0 &&
	program.commands.some(
		(c) => c.name() === argv[0] || c.aliases().includes(argv[0]!),
	);
const looksLikeOption = argv.length > 0 && argv[0]!.startsWith("-");

if (argv.length === 0) {
	const { startTui } = await import("@phus/tui");
	await startTui();
} else if (knownCommand || looksLikeOption) {
	program.parseAsync(process.argv).catch((err) => {
		console.error("[phus] fatal:", err);
		process.exit(1);
	});
} else {
	// Treat the first positional as a subcommand attempt and reject it.
	// Commander's default parseAsync just prints to stderr and exits 0;
	// we want a non-zero exit so scripts/cron can detect bad input.
	console.error(`error: unknown command '${argv[0]}'`);
	program.outputHelp({ error: true });
	process.exit(2);
}