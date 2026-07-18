// src/commands/health.ts
// `phus health` — return 0 if healthy, non-zero otherwise.
// Used by Docker HEALTHCHECK and systemd watchdog.

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "@/infra/config/index.js";

export interface HealthStatus {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

export function healthCheck(): HealthStatus {
  const checks: HealthStatus["checks"] = {};
  const config = loadConfig();

  // Tape DB reachable?
  const dbPath = config.paths.tapeDb;
  checks.tape_db = { ok: fs.existsSync(dbPath), detail: dbPath };

  // Skills dir reachable?
  const skillsDir = config.paths.skillsDir;
  checks.skills_dir = { ok: fs.existsSync(skillsDir), detail: skillsDir };

  // At least one provider key set? (Secrets stay in env — by design.)
  const providers = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY"];
  const hasKey = providers.some((p) => !!process.env[p]);
  checks.provider_key = { ok: hasKey, detail: providers.filter((p) => !!process.env[p]).join(",") || "(none)" };

  // Log file writable?
  const logFile = config.log.file;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.accessSync(logFile, fs.constants.W_OK);
    checks.log_file = { ok: true, detail: logFile };
  } catch {
    // File may not exist yet — check dir instead.
    try {
      fs.accessSync(path.dirname(logFile), fs.constants.W_OK);
      checks.log_file = { ok: true, detail: `${logFile} (dir writable)` };
    } catch (err: any) {
      checks.log_file = { ok: false, detail: err.message };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, checks };
}
