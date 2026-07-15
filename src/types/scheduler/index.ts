/**
 * scheduler types
 */

import { HookName } from "@/types/hooks/index.js";

export interface Schedule {
  name: string;
  /** Cron expression (5-field standard cron, e.g. every-5-minutes). */
  cron: string;
  /** Hook to fire when this schedule triggers. */
  hookName: HookName;
  /** Payload passed to the hook in extras.payload. */
  payload?: Record<string, unknown>;
  /** Set to false to register but disable. Default true. */
  enabled?: boolean;
  /** Optional human-readable description. */
  description?: string;
}

export interface FiredSchedule {
  schedule: Schedule;
  firedAt: number;
}

export interface SchedulerOptions {
  /** Tick interval in ms. Default: 60_000 (1 minute, since cron has 1-min resolution). */
  tickIntervalMs?: number;
  /** Optional callback for testing/observability. */
  onFire?: (fired: FiredSchedule) => void;
}