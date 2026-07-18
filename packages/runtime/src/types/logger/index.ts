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