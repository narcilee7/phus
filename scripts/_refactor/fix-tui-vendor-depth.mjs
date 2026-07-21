#!/usr/bin/env node
// scripts/_refactor/fix-tui-vendor-depth.mjs
//
// After Phase 4.1 moved vendor out of src/, all import paths need an
// extra `..` to climb out of src/. Paths that were:
//   "./vendor/..."      → "../vendor/..."
//   "../../vendor/..."   → "../../../vendor/..."
// (one extra `../` per existing prefix.)
//
// We do this by computing the depth of the importing file relative to
// `packages/tui/src/` and rebuilding the path from scratch.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { relative, dirname, sep } from "node:path";

const ROOT = "/Users/bytedance/open_source/phus";
const SRC = `${ROOT}/packages/tui/src`;
const VENDOR = `${ROOT}/packages/tui/vendor/pi-tui`;

// Match any existing "../"*-prefixed vendor path. Capture the prefix.
const RE = /(?:^|[^/])(?<prefix>(\.\.\/)+\s*)vendor\/pi-tui\//g;

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

function rebuildPath(fromFile, currentPrefix) {
	// currentPrefix is like "./" or "../../" (the dots-and-slashes
	// portion, possibly with leading "./").
	// depth in `../` units from src/ root.
	const fileDepth = fromFile.replace(SRC, "").split("/").length - 1;
	const upCount = fileDepth + 1; // 1 more than currentPrefix implies
	const newPrefix = "../".repeat(upCount);
	return `${newPrefix}vendor/pi-tui/`;
}

let total = 0;
let files = 0;
for (const f of await walk(SRC)) {
	let src = await readFile(f, "utf8");
	const fileDir = dirname(f);
	let changed = false;

	src = src.replace(/(from\s+(['"]))(?:\.\.\/)+vendor\/pi-tui\/([^'"]+)\2/g, (m, pre, q, subPath) => {
		const fileDepth = f.replace(SRC, "").split("/").length - 1;
		const newPrefix = "../".repeat(fileDepth + 1);
		const rebuilt = `${pre}${newPrefix}vendor/pi-tui/${subPath}${q}`;
		changed = true;
		total++;
		return rebuilt;
	});
	src = src.replace(/(from\s+(['"])\.\/vendor\/pi-tui\/([^'"]+)\2)/g, (m, pre, q, subPath) => {
		const fileDepth = f.replace(SRC, "").split("/").length - 1;
		const newPrefix = "../".repeat(fileDepth + 1);
		const rebuilt = `${pre}${newPrefix}vendor/pi-tui/${subPath}${q}`;
		changed = true;
		total++;
		return rebuilt;
	});

	if (changed) {
		files++;
		await writeFile(f, src, "utf8");
	}
}
console.log(`[fix-tui-vendor-depth] ${files} files, ${total} replacements`);