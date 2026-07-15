// src/core/scheduler.ts
// Cron-style scheduler — fires hooks on a recurring schedule.
//
// Usage:
//   const sched = new Scheduler(hooks);
//   sched.register({ name: "hourly", cron: "0 * * * *", hookName: "system_prompt" });
//   sched.start();   // begins ticking every minute
//   sched.stop();
//
// When a schedule fires:
//   - Build a synthetic HookContext with extras = { schedule, cron, payload }
//   - Call hooks.execute(hookName, ctx, "broadcast")
//   - Hooks can do whatever: enqueue to steering inbox, fire system prompt,
//     write to tape, etc.

import { CronExpressionParser } from "cron-parser";
import { logger } from "./logger.js";
import { makeCtx, type HookContext, type HookRegistry, type HookName } from "./hook.js";

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

export class Scheduler {
  private schedules = new Map<string, Schedule>();
  private interval: NodeJS.Timeout | undefined;
  private readonly opts: Required<SchedulerOptions>;
  private lastTick = 0;

  constructor(
    private hooks: HookRegistry,
    opts: SchedulerOptions = {},
  ) {
    this.opts = {
      tickIntervalMs: opts.tickIntervalMs ?? 60_000,
      onFire: opts.onFire ?? (() => {}),
    };
  }

  /** Register a schedule. Throws if cron is invalid. */
  register(schedule: Schedule): void {
    // Validate cron
    try {
      CronExpressionParser.parse(schedule.cron);
    } catch (err: any) {
      throw new Error(`Invalid cron expression for schedule "${schedule.name}": ${err.message}`);
    }
    if (this.schedules.has(schedule.name)) {
      throw new Error(`Schedule "${schedule.name}" already registered`);
    }
    this.schedules.set(schedule.name, { enabled: true, ...schedule });
    logger.debug("schedule.registered", {
      name: schedule.name,
      cron: schedule.cron,
      hookName: schedule.hookName,
    });
  }

  /** Remove a schedule. Returns true if removed. */
  unregister(name: string): boolean {
    const removed = this.schedules.delete(name);
    if (removed) logger.debug("schedule.unregistered", { name });
    return removed;
  }

  /** Enable or disable a schedule. */
  setEnabled(name: string, enabled: boolean): boolean {
    const s = this.schedules.get(name);
    if (!s) return false;
    this.schedules.set(name, { ...s, enabled });
    logger.debug("schedule." + (enabled ? "enabled" : "disabled"), { name });
    return true;
  }

  /** Get one schedule. */
  get(name: string): Schedule | undefined {
    return this.schedules.get(name);
  }

  /** List all schedules. */
  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Start the tick loop. Idempotent. */
  start(): void {
    if (this.interval) return;
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    logger.info("scheduler.started", {
      schedules: this.schedules.size,
      tickIntervalMs: this.opts.tickIntervalMs,
    });
  }

  /** Stop the tick loop. Idempotent. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      logger.info("scheduler.stopped", {});
    }
  }

  /** Run one tick: find schedules that should fire since last tick and fire them.
   *  Exposed for testing. */
  async tick(): Promise<void> {
    const now = Date.now();
    const since = this.lastTick;
    this.lastTick = now;

    for (const s of this.schedules.values()) {
      if (s.enabled === false) continue;
      try {
        const fired = this.shouldFireSince(s, since, now);
        if (!fired) continue;
        await this.fire(s, now);
      } catch (err: any) {
        logger.error("schedule.tick_failed", {
          name: s.name,
          error: err.message,
        });
      }
    }
  }

  /** Decide if a schedule should fire between `since` and `now`. */
  private shouldFireSince(s: Schedule, since: number, now: number): boolean {
    try {
      // Walk back from `now` to find the most recent fire time
      const interval = CronExpressionParser.parse(s.cron, { currentDate: new Date(now) });
      const prev = interval.prev();
      const prevMs = prev.toDate().getTime();
      // Fire if previous fire time is within [since, now]
      return prevMs >= since && prevMs <= now;
    } catch {
      return false;
    }
  }

  /** Fire a schedule: call the registered hook. */
  private async fire(s: Schedule, firedAt: number): Promise<void> {
    logger.info("schedule.fired", {
      name: s.name,
      cron: s.cron,
      hookName: s.hookName,
      firedAt,
    });
    const ctx: HookContext = makeCtx({
      sessionId: `schedule:${s.name}`,
      state: {},
      tape: undefined as any,  // schedules may not have tape access
      skills: undefined as any,
      extras: {
        schedule: s.name,
        cron: s.cron,
        payload: s.payload ?? {},
        firedAt,
      },
    });
    try {
      await this.hooks.execute(s.hookName, ctx, "broadcast");
    } catch (err: any) {
      logger.error("schedule.fire_failed", {
        name: s.name,
        error: err.message,
      });
    }
    this.opts.onFire({ schedule: s, firedAt });
  }
}

/** Compute the next N fire times for a cron expression. */
export function nextFires(cron: string, count: number, start: Date = new Date()): Date[] {
  const interval = CronExpressionParser.parse(cron, { currentDate: start });
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    out.push(interval.next().toDate());
  }
  return out;
}
