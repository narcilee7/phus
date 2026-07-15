#!/usr/bin/env node
// scripts/migrate-to-aliases.mjs
// Phase 1B: convert relative imports in src/**/*.ts to @/ aliases.
//
// Rewrites:
//   import ... from "./foo.js"        -> import ... from "@/foo.js"
//   import ... from "../foo.js"       -> import ... from "@/foo.js"
//   import ... from "../../foo.js"    -> import ... from "@/foo.js"
//
// Rules:
//   - Only files under src/** are touched. test/** stays relative.
//   - Only `./` and `../` prefixed specifiers are rewritten; package
//     specifiers ("pino", "fs/promises", "@mariozechner/...") are left
//     alone.
//   - The `.js` suffix is preserved (matches moduleResolution: "bundler"
//     and ESM output convention).
//   - Inline `import("...")` calls are also rewritten.
//   - Skips specifiers that don't resolve to a file under src/.
//
// Usage: node scripts/migrate-to-aliases.mjs [--dry]

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DRY = process.argv.includes("--dry");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) yield p;
  }
}

/** Try a few candidates when resolving a relative specifier (the
 *  specifier may omit .js extension; we still want to confirm it's
 *  pointing inside src/). */
function resolveTarget(fromFile, spec) {
  const fromDir = dirname(fromFile);
  // Strip the .js suffix and the leading ./ or ../
  const raw = spec.replace(/\.js$/, "");
  let abs = resolve(fromDir, raw);
  // The target must live under src/
  if (!abs.startsWith(SRC + sep) && abs !== SRC) return null;

  // If the specifier didn't already include /index and the resolved
  // path is a directory, fall through to ./<dir>/index.ts — that's the
  // canonical "index file in a directory" pattern.
  let indexSuffix = "";
  try {
    const s = statSync(abs);
    if (s.isDirectory()) {
      indexSuffix = "/index";
      abs = join(abs, "index");
    }
  } catch {
    return null;
  }

  // Compute "@/" relative path
  const rel = relative(SRC, abs).split(sep).join("/");
  // Preserve the .js suffix so the specifier remains ESM-friendly.
  return `@/${rel}${indexSuffix ? "/index" : ""}.js`;
}

const FROM_RE = /(from\s+["'])(\.\.?\/[^"']+)(["'])/g;
const DYN_RE = /(import\(\s*["'])(\.\.?\/[^"']+)(["'])/g;

let touched = 0;
let rewrites = 0;

for (const file of walk(SRC)) {
  const original = readFileSync(file, "utf8");
  let mutated = original;

  const rewrite = (_match, p1, spec, p3) => {
    const target = resolveTarget(file, spec);
    if (!target) return _match;
    rewrites++;
    return `${p1}${target}${p3}`;
  };

  mutated = mutated.replace(FROM_RE, rewrite);
  mutated = mutated.replace(DYN_RE, rewrite);

  if (mutated !== original) {
    touched++;
    if (!DRY) writeFileSync(file, mutated, "utf8");
  }
}

console.log(`${DRY ? "[dry] " : ""}rewrites=${rewrites} files=${touched} src_root=${SRC}`);