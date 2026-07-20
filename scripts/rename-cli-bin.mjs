#!/usr/bin/env node
// scripts/rename-cli-bin.mjs
// Post-build step: rename `apps/cli/dist/main.js` -> `phus.mjs`
// so install / Dockerfile / systemd paths agree on a stable binary name
// (the legacy `dist/phus.mjs` path is preserved across the Stage-2 split).

import { renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2];
if (!dist) {
	console.error("usage: rename-cli-bin.mjs <dist-dir>");
	process.exit(1);
}

const from = join(dist, "main.js");
const to = join(dist, "phus.mjs");

if (!existsSync(from)) {
	console.error(`rename-cli-bin: ${from} not found`);
	process.exit(1);
}

renameSync(from, to);

// Also rename the source map if it exists (tsc emits one next to the .js).
const fromMap = join(dist, "main.js.map");
const toMap = join(dist, "phus.mjs.map");
if (existsSync(fromMap)) {
	renameSync(fromMap, toMap);
}

console.log(`rename-cli-bin: ${from} -> ${to}`);
