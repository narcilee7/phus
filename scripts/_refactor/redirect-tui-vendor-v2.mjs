#!/usr/bin/env node
// scripts/_refactor/redirect-tui-vendor-v2.mjs
//
// Phase 4.3 — fix vendor paths after vendor moved from
// packages/tui/src/vendor/ to packages/tui/vendor/.
//   `./vendor/pi-tui/foo.js` → `../vendor/pi-tui/foo.js`
//
// (All vendor imports were originally `@/vendor/pi-tui/foo.js`,
// rewritten to `./vendor/pi-tui/foo.js` during Phase 1's @/ →
// relative sweep. After Phase 4.1 moved vendor out of src/, those
// need an extra `..` to climb out of src/.)

import { readFile, writeFile, readdir, stat } from "node:fs/promises";

const ROOT = "/Users/bytedance/open_source/phus";
const SRC = `${ROOT}/packages/tui/src`;

const RE = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+(['"])(\.\/vendor\/pi-tui\/[^'"]+)\1/g;

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
	const next = src.replace(RE, (_m, quote, path) => {
		const newPath = `../${path.slice(2)}`; // "./vendor/..." → "../vendor/..."
		return `from ${quote}${newPath}${quote}`;
	});
	const count = (src.match(RE) || []).length;
	if (count > 0) {
		total += count;
		changedFiles++;
		await writeFile(f, next, "utf8");
	}
}
console.log(`[redirect-tui-vendor-v2] ${changedFiles} files, ${total} replacements`);