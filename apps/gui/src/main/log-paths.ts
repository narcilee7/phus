// apps/gui/src/main/log-paths.ts
// Redirects all cwd-relative paths the Phus runtime relies on to the
// Electron userData directory. Without this, packaged Electron apps would
// read/write ./tape.sqlite, ./logs/phus.jsonl, ./.phus/... against the
// app install dir, which is read-only on macOS/Windows.
//
// Must run BEFORE loadConfig() / initLogger() are called anywhere.

import { app } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface RedirectedPaths {
  /** $PHUS_HOME — phus.config.yaml + skills + phus.md + plans.sqlite */
  home: string;
  /** $PHUS_LOG_FILE — pino destination */
  logFile: string;
  /** process.cwd() override for any safety.ts allowlist checks */
  cwd: string;
}

/** Set process.env + process.cwd() so every downstream Phus module sees
 *  stable, writable paths under app.getPath('userData'). Idempotent. */
export function redirectPhusPaths(): RedirectedPaths {
  const userData = app.getPath("userData");
  const home = join(userData, ".phus");
  const logsDir = join(userData, "logs");
  const logFile = join(logsDir, "phus.jsonl");

  // Ensure both dirs exist before anything else tries to write into them.
  mkdirSync(home, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  // Set env BEFORE any Phus module reads it via loadConfig / envOrYaml.
  // loadConfig's precedence: Env > YAML > default, so env wins.
  process.env["PHUS_HOME"] = home;
  process.env["PHUS_LOG_FILE"] = logFile;

  // Override cwd so safety.ts's file_write allowlist (./skills, ./.phus,
  // ./tmp, ./out) resolves under userData. Note: many Electron APIs
  // rely on cwd too — we pick userData (writable, app-private).
  try {
    process.chdir(home);
  } catch {
    // Best-effort — if it fails the runtime still functions, just with
    // cwd-relative paths resolving against the original cwd.
  }

  return { home, logFile, cwd: home };
}