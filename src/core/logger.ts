// src/core/logger.ts
// Structured JSON logger using pino.
// All output goes to $PHUS_LOG_FILE (default ./logs/phus.jsonl).
// Use `phus logs` CLI to query.

import pino from "pino";
import * as fs from "node:fs";
import * as path from "node:path";

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface LogEvent {
  ts: number;
  level: LogLevel;
  event: string;
  sessionId?: string;
  [key: string]: unknown;
}

function logPath(): string {
  const p = process.env.PHUS_LOG_FILE ?? "./logs/phus.jsonl";
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

function levelFromEnv(): LogLevel {
  const l = (process.env.PHUS_LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS.includes(l) ? l : "info";
}

let _logger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;
  _logger = pino(
    {
      level: levelFromEnv(),
      base: { service: "phus", pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    pino.destination({ dest: logPath(), sync: false, mkdir: true }),
  );
  return _logger;
}

/** Emit one structured event. Always includes ts, level, event. */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  getLogger()[level]({ event, ...fields });
}

export const logger = {
  fatal: (event: string, fields?: Record<string, unknown>) => log("fatal", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
  warn:  (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  info:  (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  trace: (event: string, fields?: Record<string, unknown>) => log("trace", event, fields),
};
