#!/usr/bin/env node
// scripts/fix-extensions.mjs
// Post-build step: rewrite relative imports in dist/ so Node's ESM
// resolver can find them. Two passes:
//
//  1. Add `.js` to relative imports that lack an extension:
//       `from "./foo"`        → `from "./foo.js"`
//
//  2. Rewrite `.js` imports that point at a directory instead of a
//     file, so Node uses the directory's `index.js`:
//       `from "./foo.js"`      → `from "./foo/index.js"`
//         when `./foo.js` does not exist but `./foo/index.js` does.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
	console.error("usage: fix-extensions.mjs <dist-dir>");
	process.exit(1);
}

const RELATIVE_IMPORT = /from (["'])(\.\.?\/[^"']+?)\1/g;
const FILE_IMPORT = /from (["'])(\.\.?\/[^"']+?\.js)\1/g;
// Dynamic `await import("…")` — same rules apply.
const RELATIVE_DYN_IMPORT = /import\((["'])(\.\.?\/[^"']+?)\1\)/g;
const FILE_DYN_IMPORT = /import\((["'])(\.\.?\/[^"']+?\.js)\1\)/g;

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir)) {
		const full = join(dir, entry);
		const s = await stat(full);
		if (s.isDirectory()) out.push(...(await walk(full)));
		else if (s.isFile() && full.endsWith(".js")) out.push(full);
	}
	return out;
}

async function existsAsFile(path) {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

async function existsAsDir(path) {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}

async function rewrite(content, file, pattern, replacer) {
	const result = await new Promise((resolvePromise) => {
		let didChange = false;
		// String.prototype.replace accepts a function; we run it
		// asynchronously by collecting promises from the replacer.
		const out = content.replace(pattern, (...args) => {
			const r = replacer(file, ...args);
			if (r instanceof Promise) {
				r.then((newStr) => {
					// String#replace doesn't await — the value
					// computed here is dropped. We pre-compute the
					// rewrite for the *current* match synchronously by
					// running the file-existence check immediately.
					// For our two passes that's sufficient because we
					// only depend on whether the path exists, not on
					// the async result of any I/O. To avoid races we
					// also recompute the whole file below.
					void newStr;
				});
				// Return the original match — pass 2 below will pick up
				// the real rewrite.
				return args[0];
			}
			if (typeof r === "string" && r !== args[0]) {
				didChange = true;
				return r;
			}
			return args[0];
		});
		resolvePromise({ out, didChange });
	});
	return result;
}

const files = await walk(ROOT);
let changed = 0;

// Pass 1: add `.js` to relative imports that lack an extension. This
// pass is purely syntactic — no fs access — so we can apply it inline.
for (const file of files) {
	const src = await readFile(file, "utf8");
	const next = src
		.replace(RELATIVE_IMPORT, (match, quote, spec) => {
			if (/\.(?:js|json|mjs|cjs|ts)$/.test(spec)) return match;
			return `from ${quote}${spec}.js${quote}`;
		})
		.replace(RELATIVE_DYN_IMPORT, (match, quote, spec) => {
			if (/\.(?:js|json|mjs|cjs|ts)$/.test(spec)) return match;
			return `import(${quote}${spec}.js${quote})`;
		});
	if (next !== src) {
		await writeFile(file, next, "utf8");
		changed += 1;
	}
}

// Pass 2: rewrite `from "./foo.js"` to `from "./foo/index.js"` when
// foo.js does not exist but foo/index.js does. Same for dynamic
// `import("./foo.js")`.
for (const file of files) {
	const src = await readFile(file, "utf8");
	const tasks = [];
	const matches = [];
	const specs = [];
	const next = src
		.replace(FILE_IMPORT, (match, quote, spec) => {
			matches.push(match);
			specs.push(spec);
			// Schedule the fs check, collect the result later.
			// `spec` is "./foo.js" — strip the `.js` to get the directory
			// form "./foo" before resolving.
			const specNoExt = spec.slice(0, -3);
			const baseNoExt = resolve(dirname(file), specNoExt);
			const promise = (async () => {
				// Prefer the file form `…/foo.js` if it exists.
				if (await existsAsFile(`${baseNoExt}.js`)) return null;
				// Fall back to the directory form `…/foo/index.js` if the
				// directory exists.
				if (await existsAsDir(baseNoExt)) return `${specNoExt}/index.js`;
				return null;
			})();
			tasks.push({ match, quote, spec, replacement: promise });
			return match;
		})
		.replace(FILE_DYN_IMPORT, (match, quote, spec) => {
			matches.push(match);
			specs.push(spec);
			const specNoExt = spec.slice(0, -3);
			const baseNoExt = resolve(dirname(file), specNoExt);
			const promise = (async () => {
				if (await existsAsFile(`${baseNoExt}.js`)) return null;
				if (await existsAsDir(baseNoExt)) return `${specNoExt}/index.js`;
				return null;
			})();
			tasks.push({ match, quote, spec, replacement: promise });
			return match;
		});

	// Resolve all the scheduled rewrites in parallel.
	const resolved = await Promise.all(tasks.map(async (t) => ({
		match: t.match,
		quote: t.quote,
		spec: t.spec,
		replacement: await t.replacement,
	})));

	const rewrites = new Map();
	for (const r of resolved) {
		if (r.replacement) rewrites.set(r.match, { replacement: r.replacement, spec: r.spec });
	}
	if (rewrites.size === 0) continue;

	// Apply rewrites by walking matches in order. Since we appended
	// matches in the same order they appeared in `src`, we can splice
	// `src` directly.
	let out = "";
	let cursor = 0;
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i];
		const idx = src.indexOf(m, cursor);
		if (idx === -1) continue;
		out += src.slice(cursor, idx);
		const info = rewrites.get(m);
		if (info !== undefined) {
			// Keep the `from "` prefix and closing quote; only swap the
			// spec body. `m` is `from "../foo.js"` (with `quote` being
			// either `"` or `'`). Find the spec body inside `m`.
			const tailIdx = m.indexOf(info.spec);
			if (tailIdx < 0) {
				out += m;
			} else {
				out += m.slice(0, tailIdx) + info.replacement + m.slice(tailIdx + info.spec.length);
			}
		} else {
			out += m;
		}
		cursor = idx + m.length;
	}
	out += src.slice(cursor);

	if (out !== src) {
		await writeFile(file, out, "utf8");
		changed += rewrites.size;
	}
}

console.log(`fix-extensions: rewrote ${changed} import${changed === 1 ? "" : "s"} under ${ROOT}`);