// src/core/internal-commands/types.ts
// Public types for the internal-command subsystem.

import type { PhusAgentFacade } from "@/bridge/pi-agent.js";
import type { ChannelAdapter } from "@/channels/base.js";

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
 * read through `agent` (the PhusAgentFacade), which exposes every
 * diagnostic they need without reaching through `_internal`.
 *
 *  - `agent` covers tape / skills / policy / model / session / plugins
 *  - `home` is the Phus home directory (for skills/drafts lookup)
 *  - `mesh` is optional: only present in gateway mode where a mesh is running
 *  - `scheduler` is optional: only present in gateway mode
 *  - `extraChannels` is the channel list passed to `agent.reloadSkillsAndPlugins`
 *    (typically `[]` for CLI, populated for the TUI)
 */
export interface InternalCommandServices {
  agent: PhusAgentFacade;
  home: () => string;
  mesh?: import("@/core/llm/provider-mesh/contract.js").MeshLike;
  scheduler?: import("@/core/runtime/scheduler.js").Scheduler | undefined;
  extraChannels?: () => ChannelAdapter[];
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