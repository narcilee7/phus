// src/core/internal-commands/registry.ts
// Per-instance command registry. Pure data structure; no module-level
// state, no globals. Phase 4 will construct one of these per agent.

import { logger } from "@/infra/logging.js";
import type {
  CommandSurface,
  InternalCommand,
  InternalCommandServices,
  ParsedCommand,
} from "./types.js";
import { parse } from "./parser.js";

export interface RegistryOptions {
  /** When true, an exception in a handler is logged but does not
   *  propagate. Defaults to true. */
  isolateHandlerErrors?: boolean;
}

export class InternalCommandRegistry {
  private readonly commands = new Map<string, InternalCommand>();
  private readonly services: InternalCommandServices;
  private readonly isolateHandlerErrors: boolean;

  constructor(services: InternalCommandServices, opts: RegistryOptions = {}) {
    this.services = services;
    this.isolateHandlerErrors = opts.isolateHandlerErrors ?? true;
  }

  /** Services the registry was built with (read-only). */
  getServices(): InternalCommandServices {
    return this.services;
  }

  /** Register an internal command. Throws if name already taken unless
   *  `replace: true` is passed. */
  register(cmd: InternalCommand, opts: { replace?: boolean } = {}): void {
    if (this.commands.has(cmd.name) && !opts.replace) {
      throw new Error(`Internal command "${cmd.name}" already registered`);
    }
    this.commands.set(cmd.name, cmd);
  }

  /** Unregister an internal command. Returns true if removed. */
  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  /** List all registered commands (insertion order). */
  list(): InternalCommand[] {
    return [...this.commands.values()];
  }

  /** Look up a command by name. */
  get(name: string): InternalCommand | undefined {
    return this.commands.get(name);
  }

  /** Render a help table for `,help`. */
  renderHelp(): string {
    const cmds = this.list().sort((a, b) => a.name.localeCompare(b.name));
    const lines = ["internal commands (prefix ,):", ""];
    if (cmds.length === 0) return lines.join("\n") + "  (none registered)";
    const maxName = Math.max(...cmds.map((c) => c.name.length));
    for (const c of cmds) {
      const usage = c.usage ? ` ${c.usage}` : "";
      lines.push(`  ,${c.name.padEnd(maxName)}${usage}  — ${c.description}`);
    }
    return lines.join("\n");
  }

  /** Parse + execute a line. Returns the handler's string, null for
   *  silent success, or the literal `"not-a-command"` if the line is
   *  not a `,foo` line at all (so the caller can fall through to AI). */
  async execute(
    line: string,
    surface: CommandSurface = "cli",
  ): Promise<string | null | "not-a-command"> {
    const parsed: ParsedCommand | null = parse(line);
    if (!parsed) return "not-a-command";
    const cmd = this.commands.get(parsed.name);
    if (!cmd) {
      return `unknown command: ,${parsed.name}. Try ,help.`;
    }
    try {
      const result = await cmd.handler({
        args: parsed.args,
        positional: parsed.positional,
        surface,
      });
      logger.debug("internal_command.executed", {
        name: parsed.name,
        surface,
        hasResult: result !== null,
      });
      return result;
    } catch (err: any) {
      logger.error("internal_command.failed", {
        name: parsed.name,
        error: err.message,
      });
      if (this.isolateHandlerErrors) {
        return `error in ,${parsed.name}: ${err.message ?? err}`;
      }
      throw err;
    }
  }
}
