// src/infra/config/defaults.ts
// Single source of fallback values used by loadConfig().
//
// Every key here used to be duplicated across many call sites
// (e.g. PHUS_HOME was read in 11 files). It now lives here.

export const DEFAULTS = {
  /** $PHUS_HOME — where skills, tape, plugins, startup.sh live. */
  home: "./.phus",
  /** SQLite tape path. */
  tapeDb: "./tape.sqlite",
  /** Skills directory (Agent Skills standard layout). */
  skillsDir: "./skills",
  /** Structured JSON log path (one event per line, pino). */
  logFile: "./logs/phus.jsonl",
  /** Minimum log level. */
  logLevel: "info" as LogLevelLiteral,
  /** Active provider profile name when PHUS_PROFILE unset and YAML has no default. */
  defaultProfile: "default",
  /** Default <provider>/<modelId> for the `default` profile. */
  defaultModel: "anthropic/claude-sonnet-4-20250514",
} as const;

export type LogLevelLiteral =
  | "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/** List of valid log levels (also used by `phus health` validation). */
export const LOG_LEVELS: readonly LogLevelLiteral[] = [
  "fatal", "error", "warn", "info", "debug", "trace",
] as const;