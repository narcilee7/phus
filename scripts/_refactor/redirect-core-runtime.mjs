#!/usr/bin/env node
// scripts/_refactor/redirect-core-runtime.mjs
// One-shot rewrite: change `@phus/core/runtime/<X>/...` to
// `@phus/runtime/core/runtime/<X>/...` for X in {plan, evolution,
// verifier, executor, subagent}.
//
// Reason: those modules live in @phus/runtime today and the move to
// @phus/core is a Phase 2.1' follow-up. The cross-package imports
// pointing at @phus/core/runtime/<X>/ were a Stage-1 half-migration
// artifact; this rewrite restores the correct (current) target.

import { readFile, writeFile } from "node:fs/promises";

const FILES = [
	"packages/runtime/src/infra/meta/plan-tools.ts",
	"packages/runtime/src/infra/meta/index.ts",
	"packages/runtime/src/infra/meta/evolution-tools.ts",
	"packages/runtime/src/core/runtime/executor/types.ts",
	"packages/runtime/src/bridge/pi-agent.ts",
	"packages/runtime/src/commands/resume.ts",
];

const RE = /@phus\/core\/runtime\/(plan|evolution|verifier|executor|subagent)\//g;

const DRY = process.argv.includes("--dry");
let total = 0;
for (const f of FILES) {
	const src = await readFile(f, "utf8");
	const next = src.replace(RE, (_m, sub) => `@phus/runtime/core/runtime/${sub}/`);
	const count = (src.match(RE) || []).length;
	if (count > 0) {
		total += count;
		if (!DRY) await writeFile(f, next, "utf8");
		console.log(`${DRY ? "[DRY] " : ""}${f}: ${count} replacement(s)`);
	}
}
console.log(`[redirect-core-runtime] ${DRY ? "DRY " : ""}total ${total} replacements`);