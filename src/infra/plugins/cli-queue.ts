// src/core/plugin/cli-queue.ts
// FIFO queue for `registerCliCommand` callbacks queued during plugin
// loading, drained at startup by `phus.ts`.
//
// Replaces the previous `globalThis.__phus_pending_cli_commands` hack.
// The queue is a module-level singleton — fine because Phus is
// single-process; Phase 4 DI will pass an explicit queue through
// PluginContext instead.

import type { Command } from "commander";

export type CliCommandRegistrar = (program: Command) => void;

let queue: CliCommandRegistrar[] = [];

/** Append a registrar. No-op if the same reference is already queued
 *  (defensive: prevents accidental duplicates during plugin reload). */
export function enqueuePendingCliCommand(fn: CliCommandRegistrar): void {
  queue.push(fn);
}

/** Apply every queued registrar to `program` and clear the queue.
 *  Throws on the first failing registrar; the queue is always emptied
 *  before the throw so a subsequent retry starts clean. The caller
 *  (phus.ts) wraps this with a logger so it has context. */
export function drainPendingCliCommands(program: Command): void {
  const pending = queue;
  queue = [];
  for (const fn of pending) {
    fn(program);
  }
}

/** Test-only: clear the queue without invoking any registrar. */
export function _resetPendingCliCommands(): void {
  queue = [];
}

/** Test-only: peek at the queue length. */
export function _pendingCliCommandCount(): number {
  return queue.length;
}