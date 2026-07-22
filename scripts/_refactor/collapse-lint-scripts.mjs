#!/usr/bin/env node
// scripts/_refactor/collapse-lint-scripts.mjs
//
// Phase 6.4 — drop per-package `lint` scripts in favor of a single
// root-level `pnpm lint`. Each package keeps its own `typecheck` /
// `build` / `test` scripts; lint lives at the root where one
// .oxlintrc.json governs all of packages/, apps/, test/.

import { readFile, writeFile } from "node:fs/promises";

const FILES = [
	"packages/shared/package.json",
	"packages/core/package.json",
	"packages/runtime/package.json",
	"packages/tui/package.json",
	"packages/phus-design/package.json",
	"apps/cli/package.json",
];

const RE = /\n\t+"lint": "[^"]+",?\n/g;

let total = 0;
for (const f of FILES) {
	const src = await readFile(f, "utf8");
	const next = src.replace(RE, "\n");
	if (next !== src) {
		await writeFile(f, next, "utf8");
		console.log("removed lint from", f);
		total++;
	}
}
console.log(`[collapse-lint-scripts] cleaned ${total} files`);