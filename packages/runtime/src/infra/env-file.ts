// src/infra/env-file.ts
// Minimal dotenv-style loader for `$PHUS_HOME/.env`. Loads KEY=VALUE pairs
// into process.env only when the key is not already set, mirroring the
// standard dotenv "do not overwrite" convention.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULTS } from "./config/defaults.js";

/** Load `.env` from the Phus home directory if it exists.
 *  Existing process.env values are never overwritten. */
export function loadEnvFile(home?: string): void {
  const homeDir = home ?? process.env.PHUS_HOME ?? DEFAULTS.home;
  const envPath = path.join(homeDir, ".env");
  if (!existsSync(envPath)) return;

  let data: string;
  try {
    data = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip optional surrounding quotes and unescape simple sequences.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
