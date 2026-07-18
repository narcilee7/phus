// src/tui/handler/commands/context.ts
// Shared command context. Each cluster receives the same shape so a
// dispatcher can pass it through without bespoke wrappers.

import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppAction, AppState } from "@/state/state.js";

export type CommandDispatch = (action: AppAction) => void;

/** Handler signature every slash command implements. Async because most
 *  end up awaiting agent/profile/tape I/O. Returning `void` is fine —
 *  the caller treats both `undefined` and `void` as "no special signal". */
export type CommandHandler = (arg: string, ctx: CommandContext) => Promise<void> | void;

export interface CommandContext {
  agent: PhusAgent;
  state: AppState;
  dispatch: CommandDispatch;
}

/** A `Partial<Record>` of handlers — cluster files `register()` returns
 *  one so the dispatcher unions them all together. */
export type CommandRegistry = Record<string, CommandHandler>;
