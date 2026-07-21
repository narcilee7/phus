#!/usr/bin/env node
// scripts/_refactor/fix-tui-vendor-import-clause.mjs
//
// Phase 4.3 fix-up: a previous rewrite script stripped the
// `import { ... }` clause and left just `from "..."`. Recover by
// re-attaching the import clause that was captured before the
// stripping happened. We work from a git-friendly heuristic:
// for each affected file, search the original `@/vendor/pi-tui/...`
// import statement in the file's git HEAD version and replace it
// with `../vendor/pi-tui/...` preserving the clause.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";

const ROOT = "/Users/bytedance/open_source/phus";
const SRC = `${ROOT}/packages/tui/src`;

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

// 1. For each file with a broken `from "../vendor/pi-tui/..."` line,
//    look up the original via `git show HEAD:<path>` and parse the
//    matching `@/vendor/pi-tui/...` import statement.
async function originalImportFor(file, brokenPath) {
	const rel = file.replace(`${ROOT}/`, "");
	try {
		const orig = execSync(`git show HEAD:${rel}`, { cwd: ROOT }).toString();
		// Find the import that resolves to brokenPath (relative).
		const importLines = orig
			.split("\n")
			.filter((l) => l.includes(`@/vendor/pi-tui/`));
		for (const l of importLines) {
			// Compute what the original relative path was — we need
			// the import clause and the original "@/" path.
			const m = l.match(/^(.*from\s+["'])@\/vendor\/pi-tui\/([^"']+)(["'].*)$/);
			if (!m) continue;
			const clause = m[1];
			const subPath = m[2];
			const tail = m[3];
			// Compute the expected broken path: "../vendor/pi-tui/<subPath>"
			// for files directly in src/, "../../vendor/pi-tui/<subPath>"
			// for files one level deeper. Since we don't know exactly,
			// match against the file's expected depth.
			const depth = file.replace(SRC, "").split("/").length - 1; // 0 = src root
			const expected = `${"../".repeat(depth + 1)}vendor/pi-tui/${subPath}`;
			if (expected === brokenPath) {
				return `${clause}${expected}${tail}`;
			}
		}
	} catch {}
	return null;
}

let total = 0;
let files = 0;
const RE = /^from\s+(['"])(\.\.\/vendor\/pi-tui\/[^'"]+)\1;?$/;

for (const f of await walk(SRC)) {
	const src = await readFile(f, "utf8");
	const lines = src.split("\n");
	let changed = false;
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(RE);
		if (m && i > 0 && !lines[i - 1].includes("import ")) {
			const brokenPath = m[2];
			const recovered = await originalImportFor(f, brokenPath);
			if (recovered) {
				out[out.length - 1] = recovered;
				changed = true;
				total++;
				continue;
			}
		}
		out.push(lines[i]);
	}
	if (changed) {
		files++;
		await writeFile(f, out.join("\n"), "utf8");
	}
}
console.log(`[fix-tui-vendor-import-clause] recovered ${total} import clauses across ${files} files`);