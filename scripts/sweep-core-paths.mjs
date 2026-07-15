#!/usr/bin/env node
// scripts/sweep-core-paths.mjs
// Catch-all sweep for remaining `@/core/X` paths that the strict
// `from "..."` regex missed (dynamic imports, paths with `/index.js`,
// paths inside string literals, etc.). Resolves to a real file
// under src/core/ and rewrites the import to the new location.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve("src/core");
const SCAN = ["src", "test"];

// New locations (relative to ROOT)
const NEW_DIRS = {
  // legacy top-level file → new subdir
  tape: "session/tape.ts",
  checkpoint: "session/checkpoint.ts",
  compaction: "session/compaction.ts",
  "auto-compact": "session/auto-compact.ts",
  "context-select": "session/context-select.ts",
  drafts: "session/drafts.ts",
  hook: "runtime/hook.ts",
  logger: "runtime/logger.ts",
  "skills/skill": "runtime/skills/skill.ts",
  plugin: "runtime/plugin.ts",
  "plugin/cli-queue": "runtime/plugin-cli-queue.ts",
  scheduler: "runtime/scheduler.ts",
  startup: "runtime/startup.ts",
  steering: "runtime/steering.ts",
  "exit-codes": "runtime/exit-codes.ts",
  profile: "llm/profile.ts",
  policy: "llm/policy.ts",
  meta: "llm/meta/index.ts",
  // provider-mesh: index.js / contract.js / routing.js etc.
  providerMesh: "llm/provider-mesh",
  // scheduler-runtime was folded into scheduler
  "scheduler-runtime": "runtime/scheduler.ts",
  // scheduler/retry/* consolidated into runtime/retry.ts
  "scheduler/retry/index": "runtime/retry.ts",
  "scheduler/retry/types": "runtime/retry.ts",
  "scheduler/retry/constants": "runtime/retry.ts",
};

function findReal(target) {
  // Strip extension if any
  const bare = target.replace(/\.(ts|js)$/, "");
  // Try new-dir/file.ts first, then new-dir/file/index.ts
  const candidates = [
    join(ROOT, bare + ".ts"),
    join(ROOT, bare + ".tsx"),
    join(ROOT, bare, "index.ts"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function resolveImport(importPath) {
  // Only act on `@/core/...`
  if (!importPath.startsWith("@/core/")) return null;
  const subpath = importPath.slice("@/core/".length).replace(/\.(ts|js)$/, "");
  // Handle "internal-commands" → "runtime/internal-commands/index.ts"
  if (subpath === "internal-commands") {
    return "@/core/runtime/internal-commands/index.js";
  }
  // Handle provider-mesh/* → llm/provider-mesh/*
  if (subpath === "provider-mesh" || subpath.startsWith("provider-mesh/")) {
    const rest = subpath.slice("provider-mesh".length);
    return `@/core/llm/provider-mesh${rest === "" ? "/index" : rest}.js`;
  }
  // Direct lookup in NEW_DIRS
  const mapped = NEW_DIRS[subpath];
  if (mapped) {
    // Convert "runtime/x.ts" → "@/core/runtime/x.js"
    return `@/core/${mapped.replace(/\.ts$/, ".js")}`;
  }
  // Fallback: walk filesystem under src/core/ and try to find by basename
  for (const [key, val] of Object.entries(NEW_DIRS)) {
    if (subpath === key || subpath.startsWith(key + "/")) {
      const rest = subpath.slice(key.length);
      return `@/core/${val.replace(/\.ts$/, "")}${rest}.js`;
    }
  }
  return null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) yield p;
  }
}

// Match EITHER `from "..."` OR `import("...")` OR `import("...")`
const PATTERNS = [
  /(from\s+["'])@\/core\/[^"']+(["'])/g,
  /(import\(\s*["'])@\/core\/[^"']+(["']\s*\))/g,
];

let touched = 0;
let rewrites = 0;

for (const root of SCAN) {
  for (const file of walk(root)) {
    const original = readFileSync(file, "utf8");
    let mutated = original;

    for (const re of PATTERNS) {
      mutated = mutated.replace(re, (match, p1, p2) => {
        const importPath = match.slice(p1.length, match.length - p2.length);
        const resolved = resolveImport(importPath);
        if (!resolved || resolved === importPath) return match;
        rewrites++;
        return `${p1}${resolved}${p2}`;
      });
    }

    if (mutated !== original) {
      touched++;
      writeFileSync(file, mutated, "utf8");
    }
  }
}

console.log(`Rewrites=${rewrites} files=${touched}`);