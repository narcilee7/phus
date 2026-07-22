// src/core/startup.ts
// Bootstrap: check for AI-written startup.sh and run it; otherwise default gateway.
// Mirrors Bub's on-boot hook pattern.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { logger } from "./logging.js";
import { loadConfig } from "./config/index.js";

type StartupMode = "custom" | "fallback" | "default";

const STARTUP_NOT_FOUND = "startup.not_found";
const STARTUP_FOUND = "startup.found";
const STARTUP_OUTPUT = "startup.output";
const STARTUP_FAILED = "startup.failed"

export function startupScriptPath(): string {
  return path.join(loadConfig().paths.home, "startup.sh");
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
    logger.info(STARTUP_NOT_FOUND, { path: script });
    return "default";
  }
  logger.info(STARTUP_FOUND, { path: script });
  try {
    const out = execFileSync("sh", [script], {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (out.trim()) logger.info(STARTUP_OUTPUT, { output: out });
    return "custom";
  } catch (err: any) {
    logger.error(STARTUP_FAILED, { path: script, error: err.message });
    return "fallback";
  }
}

