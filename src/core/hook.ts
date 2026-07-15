// src/core/hook.ts
// Bub-style hook registry with three execution modes:
//   - firstresult: return the first non-null implementation result
//   - chain:       pipe ctx through each implementation in priority order
//   - broadcast:   invoke every implementation in parallel, return all results
//
// Based on Bub's hookspecs.py semantics.

import type { Envelope, State, Skill } from "./types.js";
import type { Tape } from "./tape.js";
import type { SkillRegistry } from "./skill.js";
import { logger } from "./logger.js";

/** Names of hooks supported by Phus. Mirrors Bub's hookspecs.py. */
export type HookName =
  | "resolve_session"
  | "load_state"
  | "build_prompt"
  | "system_prompt"
  | "build_tape_context"
  | "before_llm_call"
  | "after_llm_call"
  | "before_tool_call"
  | "after_tool_call"
  | "render_outbound"
  | "dispatch_outbound"
  | "save_state"
  | "on_error"
  | "admit_message"
  | "provide_channels"
  | "register_cli_commands"
  | "provide_steering_inbox";

/** Context passed to every hook implementation. */
export interface HookContext {
  envelope?: Envelope;
  sessionId: string;
  state: State;
  tape: Tape;
  skills: SkillRegistry;
  /** Free-form extras (model output, tool call args, etc) — hook-specific. */
  extras: Record<string, unknown>;
}

export type HookMode = "firstresult" | "chain" | "broadcast";

export type HookImpl<T = unknown> = (ctx: HookContext) => Promise<T | undefined | null>;

interface RegisteredHook {
  impl: HookImpl<any>;
  priority: number;
}

export interface RegisterOptions {
  mode?: HookMode;
  priority?: number;
}

export class HookRegistry {
  private hooks = new Map<HookName, Array<RegisteredHook>>();
  private modes = new Map<HookName, HookMode>();
  private isolateErrors = false;

  constructor(opts: { isolateErrors?: boolean } = {}) {
    this.isolateErrors = opts.isolateErrors ?? false;
  }

  /** Register an implementation for a hook. Default mode is `chain`. */
  register<T>(name: HookName, impl: HookImpl<T>, opts: RegisterOptions = {}): void {
    const { mode = "chain", priority = 0 } = opts;
    const arr = this.hooks.get(name) ?? [];
    arr.push({ impl, priority });
    // Higher priority first; stable for equal priority.
    arr.sort((a, b) => b.priority - a.priority);
    this.hooks.set(name, arr);
    // First registration sets the default mode; later registrations don't override.
    if (!this.modes.has(name)) this.modes.set(name, mode);
  }

  /** Execute all implementations of a hook according to its registered mode.
   *
   *  With `isolateErrors: true`, a single hook throwing does NOT abort the
   *  chain — the error is logged via `logger.error` and the previous result
   *  is used. Without isolation, the first throw propagates (Bub default). */
  async execute<T>(name: HookName, ctx: HookContext, mode?: HookMode): Promise<T> {
    const chain = this.hooks.get(name) ?? [];
    const effective = mode ?? this.modes.get(name) ?? "chain";

    if (effective === "firstresult") {
      for (const { impl } of chain) {
        try {
          const r = await impl(ctx);
          if (r !== undefined && r !== null) return r as T;
        } catch (err) {
          this.handleHookError(name, err, ctx);
        }
      }
      return undefined as T;
    }

    if (effective === "chain") {
      let current: HookContext = ctx;
      for (const { impl } of chain) {
        try {
          current = (await impl(current)) ?? current;
        } catch (err) {
          this.handleHookError(name, err, ctx);
        }
      }
      return current as T;
    }

    // broadcast
    const results = await Promise.all(
      chain.map(async ({ impl }) => {
        try {
          return await impl(ctx);
        } catch (err) {
          this.handleHookError(name, err, ctx);
          return undefined;
        }
      }),
    );
    return results.filter((r) => r !== undefined && r !== null) as T;
  }

  private handleHookError(name: HookName, err: unknown, ctx: HookContext): void {
    if (this.isolateErrors) {
      logger.error("hook.failed_isolated", {
        hook: name,
        sessionId: ctx.sessionId,
        error: (err as Error).message ?? String(err),
      });
    } else {
      throw err;
    }
  }

  /** Inspect registered implementations (used by `phus hooks` diagnostic command). */
  report(): Record<string, Array<{ priority: number; mode: HookMode }>> {
    const out: Record<string, Array<{ priority: number; mode: HookMode }>> = {};
    for (const [name, impls] of this.hooks) {
      out[name] = impls.map(({ priority }) => ({
        priority,
        mode: this.modes.get(name) ?? "chain",
      }));
    }
    return out;
  }
}

/** Convenience builder for a base HookContext. */
export function makeCtx(
  partial: Partial<HookContext> & { tape: Tape; skills: SkillRegistry },
): HookContext {
  return {
    envelope: partial.envelope,
    sessionId: partial.sessionId ?? "",
    state: partial.state ?? {},
    tape: partial.tape,
    skills: partial.skills,
    extras: partial.extras ?? {},
  };
}
