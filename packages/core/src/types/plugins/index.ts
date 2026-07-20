/**
 * Plugin definitions.
 *
 * Pure types — runtime modules (HookRegistry, ChannelAdapter,
 * InternalCommand) are described by narrow functional interfaces so
 * the type layer does not depend on the implementation layer.
 */

import type { Command } from "commander";
import type { Skill } from "../types/skill.js";
import type { HookName, HookMode, HookImpl } from "../types/hooks/index.js";

/**
 * Narrow view of `HookRegistry` — only the surface plugins actually
 * consume. The concrete `HookRegistry` in `core/hook.ts` satisfies
 * this structurally.
 */
export interface HookBus {
  register<T>(
    name: HookName,
    impl: HookImpl<T>,
    opts?: { mode?: HookMode; priority?: number },
  ): void;
}

export interface ChannelLike {
  readonly name: string;
  listen(agent: unknown): void | Promise<void>;
  send(outbounds: readonly unknown[]): Promise<void>;
  close?(): void | Promise<void>;
}

/**
 * Narrow view of an internal REPL command. The concrete `InternalCommand`
 * type in `core/internal-commands/` will satisfy this structurally.
 */
export interface InternalCommandLike {
  name: string;
  description: string;
  usage?: string;
  handler: (ctx: {
    args: Record<string, string>;
    positional: string[];
    surface: "cli" | "tui";
  }) => string | null | Promise<string | null>;
}

export interface Plugin {
  name: string;
  /** Called once after the plugin is loaded. */
  register: (ctx: PluginContext) => void | Promise<void>;
}

export interface PluginContext {
  hooks: HookBus;
  /** Plugin's own config slice from phus.config.yaml. */
  config: unknown;
  /** Register a skill without writing to disk. */
  registerSkill: (skill: Skill) => void;
  /** Register a custom channel. */
  registerChannel: (channel: ChannelLike) => void;
  /** Add a `,foo` internal command (Bub-style REPL). */
  registerInternalCommand: (cmd: InternalCommandLike) => void;
  /** Add a Commander subcommand (called once at startup). */
  registerCliCommand: (fn: (program: Command) => void) => void;
}

export type LoadedStatus = "ok" | "error";

export interface LoadedPlugin {
  name: string;
  path: string;
  status: LoadedStatus;
  error?: string;
}

export interface PluginLoaderOptions {
  home?: string;
  configFile?: string;
}