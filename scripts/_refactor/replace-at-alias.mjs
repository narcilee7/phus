#!/usr/bin/env node
// scripts/_refactor/replace-at-alias.mjs
//
// One-shot mechanical rewrite: replace `@/<rest>` import strings with the
// correct relative path from the importing file to the target.
//
// Operates only on packages where the alias maps to the package's own `src/`:
//   packages/runtime/src/**    + packages/runtime/test/**
//   packages/tui/src/**        + packages/tui/test/**
//
// Cross-package imports of the form `from "@phus/runtime/..."` are NOT touched.
// Comments containing `@/` are left alone.
//
// Usage:  node scripts/_refactor/replace-at-alias.mjs [--dry] [--pkg=runtime]
//
// Without `--dry` the script writes files in place.

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

const TARGETS = [
	{ pkg: "runtime", pkgRoot: join(ROOT, "packages/runtime"), srcDir: "src", testDirs: ["test"] },
	{ pkg: "tui", pkgRoot: join(ROOT, "packages/tui"), srcDir: "src", testDirs: ["test"] },
];

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has("--dry");
const ONLY = [...ARGS].find((a) => a.startsWith("--pkg="))?.slice("--pkg=".length);

// Match `@/<rest>` ONLY inside an import context. We use four flavors to
// catch static imports, dynamic imports, re-exports, and require().
// Each pattern requires either `from`, `import(`, `require(`, or `export ... from`.
//
// Capture-group shape (the same for every pattern):
//   group 1: prefix (e.g. `from ` or `import(` or `require(`)
//   group 2: the FULL quoted alias path, including BOTH quote characters
//            (e.g. `"@/foo.js"`). Group 2 MUST NOT include the closing paren
//            for dynamic/require patterns, so we factor `)` out into its own
//            group at the end.
//
// The `\3` back-reference ensures the opening and closing quote are the
// same character (no mixing of `"` and `'`).
const PATTERNS = [
	// static + re-export: import ... from "@/x"  /  export ... from "@/x"
	/(from\s+|export\s+(?:\{[^}]*\}\s+)?from\s+)((["'])@\/[^"']+\3)/g,
	// dynamic: await import("@/x")  —  `)` is OUTSIDE group 2 so slice(1, -1) works
	/(import\s*\(\s*)((["'])@\/[^"']+\3)(\s*\))/g,
	// require: require("@/x")  — same shape
	/(require\s*\(\s*)((["'])@\/[^"']+\3)(\s*\))/g,
];

async function walkTs(dir) {
	const out = [];
	let entries;
	try {
		entries = await readdir(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		const s = await stat(full);
		if (s.isDirectory()) {
			if (entry === "node_modules" || entry === "dist" || entry === ".tsbuildinfo") continue;
			out.push(...(await walkTs(full)));
		} else if (/\.tsx?$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

function rewriteOne(fileText, filePath, srcRootAbs) {
	let changed = false;
	const fileDir = dirname(filePath);
	let result = fileText;
	for (const pat of PATTERNS) {
		// Reset lastIndex by creating a fresh regex each iteration
		const re = new RegExp(pat.source, pat.flags);
		result = result.replace(re, (match, prefix, quoted) => {
			// `quoted` is the FULL quoted string, e.g. `"@/foo/bar.js"` with both quotes.
			const quoteChar = quoted[0];
			const path = quoted.slice(1, -1); // @/foo/bar.js
			if (!path.startsWith("@/")) return match;

			// Resolve to absolute under srcRootAbs (strip .js → .ts)
			const aliasTarget = path.slice(2); // foo/bar.js
			const withoutJs = aliasTarget.replace(/\.js$/, "");
			const targetAbs = resolve(srcRootAbs, withoutJs);

			// Some `@/<x>` strings may point at a barrel: resolve both
			// `<x>.ts` and `<x>/index.ts` and pick whichever exists.
			// For the rewrite we just compute the relative path; tsc + the
			// runtime's fix-extensions.mjs handle the dir↔file normalization.
			const fromDir = fileDir;
			let rel = relative(fromDir, targetAbs).split(sep).join("/");
			if (!rel.startsWith(".")) rel = "./" + rel;
			const newPath = rel + ".js";

			changed = true;
			// Reconstruct: keep the original prefix verbatim (including any
			// opening paren for dynamic/require imports) and append the new
			// quoted path + the matching closing paren if the match had one.
			const closeParen = match.endsWith(")") ? ")" : "";
			return prefix + quoteChar + newPath + quoteChar + closeParen;
		});
	}
	return { text: result, changed };
}

async function main() {
	let totalFiles = 0;
	let totalChanged = 0;
	let totalReplacements = 0;

	for (const t of TARGETS) {
		if (ONLY && ONLY !== t.pkg) continue;
		const srcRootAbs = resolve(t.pkgRoot, t.srcDir);
		const dirs = [srcRootAbs, ...t.testDirs.map((d) => resolve(t.pkgRoot, d))];

		for (const dir of dirs) {
			const files = await walkTs(dir);
			for (const f of files) {
				const orig = await readFile(f, "utf8");
				const { text, changed } = rewriteOne(orig, f, srcRootAbs);
				totalFiles++;
				if (!changed) continue;
				totalChanged++;
				// Count number of replacements by diffing simple length or counting matches
				const before = (orig.match(/@\/[a-zA-Z0-9_\-/]+/g) || []).length;
				const after = (text.match(/@\/[a-zA-Z0-9_\-/]+/g) || []).length;
				totalReplacements += before - after;
				if (!DRY) {
					await writeFile(f, text, "utf8");
				}
			}
		}
	}

	console.log(
		`[replace-at-alias] ${DRY ? "DRY " : ""}scanned ${totalFiles} files, ` +
			`rewrote ${totalChanged} files, ~${totalReplacements} @/ replacements.`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});