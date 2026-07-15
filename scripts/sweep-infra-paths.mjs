#!/usr/bin/env node
// scripts/sweep-infra-paths.mjs
// Phase 8: rewrite all `@/core/...` paths that moved to `infra/`.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "test"];

const MAP = {
  // ─── @/ aliases ────────────────────────────────────────────
  "@/core/runtime/logger.js": "@/infra/logging.js",
  "@/core/runtime/logger": "@/infra/logging.js",
  "@/core/runtime/retry.js": "@/infra/retry.js",
  "@/core/runtime/retry": "@/infra/retry.js",
  "@/core/runtime/startup.js": "@/infra/bootstrap.js",
  "@/core/runtime/startup": "@/infra/bootstrap.js",
  "@/core/runtime/plugin.js": "@/infra/plugins/loader.js",
  "@/core/runtime/plugin": "@/infra/plugins/loader.js",
  "@/core/runtime/plugin-cli-queue.js": "@/infra/plugins/cli-queue.js",
  "@/core/runtime/plugin-cli-queue": "@/infra/plugins/cli-queue.js",
  "@/core/runtime/skills/skill.js": "@/infra/skills/registry.js",
  "@/core/runtime/skills/skill": "@/infra/skills/registry.js",
  "@/core/llm/profile.js": "@/infra/profile.js",
  "@/core/llm/profile": "@/infra/profile.js",
  "@/core/llm/policy.js": "@/infra/safety.js",
  "@/core/llm/policy": "@/infra/safety.js",
  "@/core/llm/meta/index.js": "@/infra/meta/index.js",
  "@/core/llm/meta/index": "@/infra/meta/index.js",
  "@/core/session/drafts.js": "@/infra/drafts.js",
  "@/core/session/drafts": "@/infra/drafts.js",
  // ─── Relative paths from test/ ─────────────────────────────
  "../src/core/runtime/logger.js": "../src/infra/logging.js",
  "../src/core/runtime/logger": "../src/infra/logging.js",
  "../src/core/runtime/retry.js": "../src/infra/retry.js",
  "../src/core/runtime/retry": "../src/infra/retry.js",
  "../src/core/runtime/startup.js": "../src/infra/bootstrap.js",
  "../src/core/runtime/startup": "../src/infra/bootstrap.js",
  "../src/core/runtime/plugin.js": "../src/infra/plugins/loader.js",
  "../src/core/runtime/plugin": "../src/infra/plugins/loader.js",
  "../src/core/runtime/plugin-cli-queue.js": "../src/infra/plugins/cli-queue.js",
  "../src/core/runtime/plugin-cli-queue": "../src/infra/plugins/cli-queue.js",
  "../src/core/runtime/skills/skill.js": "../src/infra/skills/registry.js",
  "../src/core/runtime/skills/skill": "../src/infra/skills/registry.js",
  "../src/core/llm/profile.js": "../src/infra/profile.js",
  "../src/core/llm/profile": "../src/infra/profile.js",
  "../src/core/llm/policy.js": "../src/infra/safety.js",
  "../src/core/llm/policy": "../src/infra/safety.js",
  "../src/core/llm/meta/index.js": "../src/infra/meta/index.js",
  "../src/core/llm/meta/index": "../src/infra/meta/index.js",
  "../src/core/session/drafts.js": "../src/infra/drafts.js",
  "../src/core/session/drafts": "../src/infra/drafts.js",
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) yield p;
  }
}

const PATTERNS = [
  /(from\s+["'])@\/core\/[^"']+(["'])/g,
  /(import\(\s*["'])@\/core\/[^"']+(["']\s*\))/g,
  /(from\s+["'])\.\.\/src\/core\/[^"']+(["'])/g,
  /(import\(\s*["'])\.\.\/src\/core\/[^"']+(["']\s*\))/g,
];

function resolveImport(importPath) {
  for (const [from, to] of Object.entries(MAP)) {
    if (from === importPath) return to;
  }
  return null;
}

let files = 0;
let rewrites = 0;

for (const root of ROOTS) {
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
      files++;
      writeFileSync(file, mutated, "utf8");
    }
  }
}

console.log(`Rewrites=${rewrites} files=${files}`);