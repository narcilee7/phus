#!/usr/bin/env node
// scripts/migrate-core-paths.mjs
// Phase 6: rewrite `@/core/X` imports after the session/runtime/llm
// reorg. Walks every TS/TSX file under src/ and test/ and applies a
// remap table.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ROOTS = ["src", "test"];

// Source-rooted file → destination-rooted file mapping. Anything NOT
// in this map keeps its old path (the file didn't move).
const REMAP = {
  // session/
  "@/core/tape.js": "@/core/session/tape.js",
  "@/core/tape": "@/core/session/tape.js",
  "@/core/checkpoint.js": "@/core/session/checkpoint.js",
  "@/core/checkpoint": "@/core/session/checkpoint.js",
  "@/core/compaction.js": "@/core/session/compaction.js",
  "@/core/compaction": "@/core/session/compaction.js",
  "@/core/auto-compact.js": "@/core/session/auto-compact.js",
  "@/core/auto-compact": "@/core/session/auto-compact.js",
  "@/core/context-select.js": "@/core/session/context-select.js",
  "@/core/context-select": "@/core/session/context-select.js",
  "@/core/drafts.js": "@/core/session/drafts.js",
  "@/core/drafts": "@/core/session/drafts.js",
  // runtime/
  "@/core/hook.js": "@/core/runtime/hook.js",
  "@/core/hook": "@/core/runtime/hook.js",
  "@/core/logger.js": "@/core/runtime/logger.js",
  "@/core/logger": "@/core/runtime/logger.js",
  "@/core/skills/skill.js": "@/core/runtime/skills/skill.js",
  "@/core/skills/skill": "@/core/runtime/skills/skill.js",
  "@/core/plugin.js": "@/core/runtime/plugin.js",
  "@/core/plugin": "@/core/runtime/plugin.js",
  "@/core/plugin/cli-queue.js": "@/core/runtime/plugin-cli-queue.js",
  "@/core/plugin/cli-queue": "@/core/runtime/plugin-cli-queue.js",
  "@/core/scheduler.js": "@/core/runtime/scheduler.js",
  "@/core/scheduler": "@/core/runtime/scheduler.js",
  "@/core/scheduler-runtime.js": "@/core/runtime/scheduler.js",
  "@/core/scheduler-runtime": "@/core/runtime/scheduler.js",
  "@/core/startup.js": "@/core/runtime/startup.js",
  "@/core/startup": "@/core/runtime/startup.js",
  "@/core/steering.js": "@/core/runtime/steering.js",
  "@/core/steering": "@/core/runtime/steering.js",
  "@/core/exit-codes.js": "@/core/runtime/exit-codes.js",
  "@/core/exit-codes": "@/core/runtime/exit-codes.js",
  "@/core/internal-commands": "@/core/runtime/internal-commands/index.js",
  "@/core/internal-commands.js": "@/core/runtime/internal-commands/index.js",
  // llm/
  "@/core/provider-mesh": "@/core/llm/provider-mesh",
  "@/core/provider-mesh.js": "@/core/llm/provider-mesh/index.js",
  "@/core/profile.js": "@/core/llm/profile.js",
  "@/core/profile": "@/core/llm/profile.js",
  "@/core/policy.js": "@/core/llm/policy.js",
  "@/core/policy": "@/core/llm/policy.js",
  "@/core/meta.js": "@/core/llm/meta/index.js",
  "@/core/meta": "@/core/llm/meta/index.js",
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) yield p;
  }
}

let touched = 0;
let rewrites = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const original = readFileSync(file, "utf8");
    let mutated = original;

    for (const [from, to] of Object.entries(REMAP)) {
      // Match `from "..."` and `from "..."` exactly (no fuzzy matching).
      const re = new RegExp(`(from\\s+["'])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])`, "g");
      const before = mutated;
      mutated = mutated.replace(re, `$1${to}$2`);
      if (mutated !== before) rewrites++;
    }

    if (mutated !== original) {
      touched++;
      writeFileSync(file, mutated, "utf8");
    }
  }
}

console.log(`Rewrites=${rewrites} files=${touched}`);