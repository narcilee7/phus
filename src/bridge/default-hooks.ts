// src/bridge/default-hooks.ts
// The default implementations for `resolve_session` and `load_state`.
// Plugins can register higher-priority impls to override.

import type { TapeLike } from "@/types/hooks/index.js";

export interface DefaultHooksDeps {
  tape: TapeLike;
}

/** Register the canonical default hook impls. Higher-priority plugin
 *  hooks win the `first_result` / `broadcast` modes. */
export function registerDefaultHooks(hooks: {
  register<T>(
    name: string,
    impl: (ctx: any) => Promise<T | undefined | null>,
    opts?: { mode?: "first_result" | "chain" | "broadcast"; priority?: number },
  ): void;
}, deps: DefaultHooksDeps): void {
  hooks.register<string>(
    "resolve_session",
    async (ctx) => {
      const env = ctx.envelope;
      if (!env) return undefined as any;
      const channel = env.channel || "cli";
      const chatId = (env.metadata as any).chatId ?? env.from ?? "default";
      return `${channel}:${chatId}`;
    },
    { mode: "first_result", priority: 0 },
  );

  hooks.register(
    "load_state",
    async (ctx) => {
      if (!ctx.sessionId) return ctx;
      const anchor = deps.tape.loadAnchor(ctx.sessionId);
      if (anchor) {
        ctx.state.lastAnchor = { name: anchor.name, ts: anchor.ts };
      }
      return ctx;
    },
    { mode: "broadcast", priority: 0 },
  );
}