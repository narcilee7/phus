// src/core/startup.ts
// Bootstrap: check for AI-written startup.sh and run it; otherwise default gateway.
// Mirrors Bub's on-boot hook pattern.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { logger } from "./logger.js";

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
    logger.info("startup.not_found", { path: script });
    return "default";
  }
  logger.info("startup.found", { path: script });
  try {
    const out = execFileSync("sh", [script], {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (out.trim()) logger.info("startup.output", { output: out });
    return "custom";
  } catch (err: any) {
    logger.error("startup.failed", { path: script, error: err.message });
    return "fallback";
  }
}
