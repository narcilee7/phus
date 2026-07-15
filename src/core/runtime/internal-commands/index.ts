// src/core/internal-commands/index.ts
// Public surface for the internal-command subsystem.
//
// Primary API:
//   createInternalCommandRegistry(services) → InternalCommandRegistry
//
// Backward-compat shim (Phase 4 will retire these):
//   initInternalCommands(getAgent, getHome)  — sets the default services
//   execute(line, surface?)                  — runs through default registry
//   parse(line)                              — pure parse, no registry
//   renderHelp()                             — uses default registry
//   register / unregister / list / get       — operate on default registry
//   registerBuiltins(services)              — populate a registry

import { logger } from "@/infra/logging.js";
import {
  InternalCommandRegistry,
  type RegistryOptions,
} from "./registry.js";
import { defineAllBuiltinCommands } from "./builtins/index.js";
import { parse } from "./parser.js";
import type {
  CommandSurface,
  InternalCommand,
  InternalCommandContext,
  InternalCommandServices,
  ParsedCommand,
} from "./types.js";

export type {
  CommandSurface,
  InternalCommand,
  InternalCommandContext,
  InternalCommandServices,
  ParsedCommand,
};
export { InternalCommandRegistry, parse };
export type { RegistryOptions };

/** Construct a fresh registry. Caller owns the lifetime; multiple
 *  agents can have independent registries (no shared state). */
export function createInternalCommandRegistry(
  services: InternalCommandServices,
  opts: RegistryOptions = {},
): InternalCommandRegistry {
  return new InternalCommandRegistry(services, opts);
}

/** Populate a registry with the default built-in command set. The
 *  registry passed in is mutated in place; the return value is the
 *  same instance for chaining. */
export function registerBuiltins(
  registry: InternalCommandRegistry,
): InternalCommandRegistry {
  const commands = defineAllBuiltinCommands(registry.getServices());
  for (const cmd of commands) registry.register(cmd);
  // ,help is registered last because it renders help for every
  // command currently in the registry — adding it later means user
  // commands registered after `registerBuiltins` show up too.
  registry.register({
    name: "help",
    description: "list internal commands",
    handler: () => registry.renderHelp(),
  });
  return registry;
}

// ─── Backward-compat shim (module-level default) ─────────────────
//
// Many call sites (cli.ts, phus.ts, ...) call `initInternalCommands`
// once per process and then use the module-level `execute` / `list` /
// `renderHelp`. We keep that pattern alive so the existing import
// sites do not need to change. Phase 4 will replace this shim with
// an explicit registry passed through DI.

let _defaultServices: InternalCommandServices | undefined;
let _defaultRegistry: InternalCommandRegistry | undefined;

function defaultRegistry(): InternalCommandRegistry {
  if (!_defaultRegistry) {
    if (!_defaultServices) {
      throw new Error(
        "internal-commands: initInternalCommands() must be called before use",
      );
    }
    _defaultRegistry = createInternalCommandRegistry(_defaultServices);
    registerBuiltins(_defaultRegistry);
  }
  return _defaultRegistry;
}

/** Set the default services used by the shim and (re)register the
 *  built-in command set against the new registry. Idempotent —
 *  repeated calls with structurally-equal services are a no-op. */
export function initInternalCommands(services: InternalCommandServices): void {
  if (_defaultServices && servicesEqual(_defaultServices, services)) {
    if (!_defaultRegistry) defaultRegistry();
    return;
  }
  _defaultServices = services;
  _defaultRegistry = undefined;
  defaultRegistry();
}

function servicesEqual(a: InternalCommandServices, b: InternalCommandServices): boolean {
  return a.agent === b.agent
    && a.home === b.home
    && a.mesh === b.mesh
    && a.scheduler === b.scheduler
    && a.extraChannels === b.extraChannels;
}

/** Reset both the default services and the default registry. Tests
 *  use this to guarantee isolation between cases. */
export function _resetInternalCommands(): void {
  _defaultServices = undefined;
  _defaultRegistry = undefined;
}

/** Execute a line through the default registry. */
export async function execute(
  line: string,
  surface: CommandSurface = "cli",
): Promise<string | null | "not-a-command"> {
  return defaultRegistry().execute(line, surface);
}

/** Register a command on the default registry. */
export function register(
  cmd: InternalCommand,
  opts: { replace?: boolean } = {},
): void {
  defaultRegistry().register(cmd, opts);
}

/** Unregister a command on the default registry. */
export function unregister(name: string): boolean {
  if (!_defaultRegistry) return false;
  return _defaultRegistry.unregister(name);
}

/** List commands on the default registry. */
export function list(): InternalCommand[] {
  if (!_defaultRegistry) return [];
  return _defaultRegistry.list();
}

/** Look up a command on the default registry. */
export function get(name: string): InternalCommand | undefined {
  if (!_defaultRegistry) return undefined;
  return _defaultRegistry.get(name);
}

/** Render help through the default registry. */
export function renderHelp(): string {
  if (!_defaultRegistry) return "internal commands: (registry not initialized)";
  return _defaultRegistry.renderHelp();
}

// Re-export logger for tests that want to assert log emissions.
export { logger };