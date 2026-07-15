// src/core/startup.ts
// Bootstrap: check for AI-written startup.sh and run it; otherwise default gateway.
// Mirrors Bub's on-boot hook pattern.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type StartupMode = "custom" | "fallback" | "default";

export function startupHome(): string {
  return process.env.PHUS_HOME ?? "./.phus";
}

export function startupScriptPath(): string {
  return path.join(startupHome(), "startup.sh");
}

/**
 * Run the AI-written startup script if present. Returns the mode used.
 * - "custom": startup.sh executed successfully
 * - "fallback": startup.sh failed, falling back to default
 * - "default": no startup.sh found
 */
export function bootstrap(timeoutMs = 30_000): StartupMode {
  const script = startupScriptPath();
  if (!fs.existsSync(script)) {
    console.log("[phus] ⛰️  No startup.sh — using default gateway.");
    return "default";
  }
  console.log(`[phus] ⛰️  Found startup.sh — executing self-defined bootstrap...`);
  try {
    const out = execFileSync("sh", [script], {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (out.trim()) console.log(out);
    return "custom";
  } catch (err: any) {
    console.error(`[phus] ⚠️  startup.sh failed (${err.message}); falling back to default.`);
    return "fallback";
  }
}
