// src/core/logger.ts
// Structured JSON logger using pino.
// All output goes to $PHUS_LOG_FILE (default ./logs/phus.jsonl).
// Use `phus logs` CLI to query.
//
// This is the runtime implementation. The `LogLevel` and `LogEvent`
// types live in `types/logger/` so consumers don't need to import pino.

import pino from "pino";
import * as fs from "node:fs";
import * as path from "node:path";
import { LEVELS, type LogLevel } from "@phus/core/types/logger/index.js";
import type { LogConfig } from "@/infra/config/schema.js";
import { LOG_LEVELS } from "@/infra/config/defaults.js";

export type { LogLevel } from "@phus/core/types/logger/index.js";
export type { LogEvent } from "@phus/core/types/logger/index.js";

function ensureDir(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function normalizeLevel(l: string | undefined): LogLevel {
  if (l && (LEVELS as readonly string[]).includes(l.toLowerCase())) {
    return l.toLowerCase() as LogLevel;
  }
  return "info";
}

interface LoggerInit {
  file: string;
  level: LogLevel;
}

let _init: LoggerInit | undefined;
let _logger: pino.Logger | undefined;

/**
 * Initialize the logger against a specific file + level. After this
 * call, `logger.warn(...)` etc. route through pino to that destination.
 *
 * `initLogger` is called by `src/phus.ts` once `loadConfig()` has
 * resolved the active log config. Tests call it explicitly with
 * per-case fixtures. Calling twice resets the logger.
 */
export function initLogger(opts: { file: string; level: string }): void {
  const level = normalizeLevel(opts.level);
  const file = ensureDir(opts.file);
  _init = { file, level };
  _logger = pino(
    {
      level,
      base: { service: "phus", pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    pino.destination({ dest: file, sync: false, mkdir: true }),
  );
}

/** Convenience: init from a ResolvedConfig.log slice. */
export function initLoggerFromConfig(log: LogConfig): void {
  initLogger({ file: log.file, level: log.level });
}

/** Reset logger state (tests). */
export function resetLogger(): void {
  _logger = undefined;
  _init = undefined;
}

/** Returns the active init params (or undefined if not initialized). */
export function currentLoggerInit(): LoggerInit | undefined {
  return _init;
}

/** Return the active logger, lazily creating one with env-based defaults. */
export function getLogger(): pino.Logger {
  if (_logger) return _logger;
  // Fallback path for code that ran before initLogger() (tests,
  // direct library use). Honors env vars still.
  const file = process.env.PHUS_LOG_FILE ?? "./logs/phus.jsonl";
  const level = normalizeLevel(process.env.PHUS_LOG_LEVEL);
  initLogger({ file, level });
  return _logger!;
}

/** Emit one structured event. Always includes ts, level, event. */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  getLogger()[level]({ event, ...fields });
}

export const logger = {
  fatal: (event: string, fields?: Record<string, unknown>) => log("fatal", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  trace: (event: string, fields?: Record<string, unknown>) => log("trace", event, fields),
};

// Re-export the config-side enum so external modules don't need to
// reach into infra/config/ just for the literal union.
export { LOG_LEVELS };