// src/core/scheduler-runtime.ts
// Runtime singleton for the Scheduler — used by ,schedule commands
// to talk to the same instance running in gateway mode.

import { Scheduler } from "@/core/scheduler.js";
import type { HookRegistry } from "@/core/hook.js";

let instance: Scheduler | undefined;

export function setScheduler(s: Scheduler): void {
  instance = s;
}

export function getScheduler(): Scheduler | undefined {
  return instance;
}

export function clearScheduler(): void {
  if (instance) instance.stop();
  instance = undefined;
}
