/**
 * Logger types — pure type definitions.
 *
 * The runtime implementation lives in `core/logger.ts` (Pino-backed) and
 * will move to `infra/logger/pino.ts` in Phase 4 once DI lands. For now
 * the concrete singleton is at `core/logger.ts`.
 */

export const LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type LogLevel = (typeof LEVELS)[number];

/** A single structured event emitted by the application. */
export interface LogEvent {
  ts: number;
  level: LogLevel;
  event: string;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * LoggerLike — minimal logger interface core classes depend on.
 *
 * Implemented by `@phus/runtime/infra/logging.js` (pino-backed). Core
 * classes accept a LoggerLike via constructor and default to a no-op
 * implementation when not provided. This keeps `core` independent of
 * `runtime` while preserving observability when wired together.
 */
export interface LoggerLike {
  trace?: (event: string, fields?: Record<string, unknown>) => void;
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
  fatal: (event: string, fields?: Record<string, unknown>) => void;
}

/** No-op logger — used as the default when core classes are constructed
 *  without an explicit logger injection. */
export const noopLogger: LoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};