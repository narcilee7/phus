#!/usr/bin/env node
// scripts/_refactor/redirect-tui-vendor.mjs
//
// One-shot: replace `@/vendor/pi-tui/...` → `./vendor/pi-tui/...`
// in packages/tui/src/. Required after moving vendored pi-tui from
// src/vendor/ to vendor/ (Phase 4.1).

import { readFile, writeFile } from "node:fs/promises";
import { relative, dirname, sep } from "node:path";

const ROOT = "/Users/bytedance/open_source/phus";
const SRC = `${ROOT}/packages/tui/src`;

const RE = /@\/vendor\/pi-tui\//g;

import { readdir, stat } from "node:fs/promises";

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir)) {
		const full = `${dir}/${entry}`;
		const s = await stat(full);
		if (s.isDirectory()) out.push(...await walk(full));
		else if (/\.tsx?$/.test(entry)) out.push(full);
	}
	return out;
}

let total = 0;
let changedFiles = 0;
for (const f of await walk(SRC)) {
	const src = await readFile(f, "utf8");
	const fileDir = dirname(f);
	const next = src.replace(RE, () => {
		// From this file, vendor lives at <tui>/vendor/, accessed via
		// relative-from-src/. Each file's relative path differs.
		const target = `${ROOT}/packages/tui/vendor/pi-tui`;
		let rel = relative(fileDir, target).split(sep).join("/");
		if (!rel.startsWith(".")) rel = "./" + rel;
		return `${rel}/`;
	});
	const count = (src.match(RE) || []).length;
	if (count > 0) {
		total += count;
		changedFiles++;
		await writeFile(f, next, "utf8");
	}
}
console.log(`[redirect-tui-vendor] ${changedFiles} files, ${total} replacements`);