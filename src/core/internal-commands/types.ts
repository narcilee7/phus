// src/core/internal-commands/types.ts
// Public types for the internal-command subsystem.

/** Where the command was invoked. */
export type CommandSurface = "cli" | "tui";

/** Context passed to every command handler at execution time. */
export interface InternalCommandContext {
  args: Record<string, string>;
  positional: string[];
  surface: CommandSurface;
}

/** An internal command. Handlers may be sync or async. Returning a
 *  string prints it to the surface; returning null is silent success. */
export interface InternalCommand {
  name: string;
  description: string;
  /** Example usage, e.g. "[n=5]" or "name=<n>". */
  usage?: string;
  handler: (ctx: InternalCommandContext) => string | null | Promise<string | null>;
}

/** Parse result returned by `parse()`. */
export interface ParsedCommand {
  name: string;
  args: Record<string, string>;
  positional: string[];
}

/**
 * Services injected into the registry. The built-in command handlers
 * read through `getAgent()` for now; in Phase 4 this becomes a narrow
 * `AgentFacade` that replaces the `_internal` reach-through with
 * explicit capabilities (`services.tape`, `services.skills`, ...).
 */
export interface InternalCommandServices {
  /** Returns the agent whose internals the builtins read. */
  getAgent: () => unknown;
  /** Phus home directory (for skills, drafts, ...). */
  getHome: () => string;
  /** Provider mesh (or undefined if no mesh has been built yet). */
  mesh?: import("@/core/provider-mesh/contract.js").MeshLike;
  /** Scheduler (or undefined if not running in gateway mode). */
  scheduler?: import("@/core/scheduler.js").Scheduler | undefined;
}

/** Narrow view of the scheduler surface used by the `,schedule.*`
 *  builtins. The concrete `Scheduler` class satisfies this. */
export interface SchedulerLike {
  list(): ReadonlyArray<{
    name: string;
    cron: string;
    hookName: string;
    enabled: boolean | undefined;
  }>;
  register(schedule: unknown): void;
  unregister(name: unknown): boolean;
  setEnabled(name: unknown, enabled: boolean): boolean;
}