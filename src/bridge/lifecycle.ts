// src/bridge/lifecycle.ts
// Async factory + disposal for `PhusAgent`. Replaces the previous
// `void this.loadPluginsAsync()` fire-and-forget pattern.

import {
  PhusAgent,
  type PhusAgentDeps,
  type PhusAgentFacade,
} from "@/bridge/pi-agent.js";
import { logger } from "@/core/logger.js";

export interface PhusAgentHandle {
  /** The agent facade — pass this to channels, TUI, commands. */
  agent: PhusAgentFacade;
  /** Internal handle for lifecycle code (shutdown handlers, tests). */
  internals: PhusAgent;
  /**
   * Release every resource the agent owns: stop the mesh health
   * timer, close the tape, unsubscribe Pi events. Safe to call
   * multiple times.
   */
  dispose: () => Promise<void>;
}

/** Resolve every dependency the agent needs and return a handle
 *  that includes the agent plus a `dispose()` for clean shutdown. */
export async function createPhusAgent(deps: PhusAgentDeps): Promise<PhusAgentHandle> {
  const internals = new PhusAgent(deps);
  // Load plugins before the agent accepts the first turn so skills
  // registered by plugins are discoverable immediately.
  const { loadPlugins } = await import("@/core/plugin.js");
  loadPlugins(internals._internal.hooks, internals._internal.channels, {
    registerRuntime: () => {
      // Runtime skill registration is intentionally not yet supported.
    },
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try { internals._internal.mesh.stopHealthChecks(); } catch { /* ignore */ }
    try { internals._internal.tape.close?.(); } catch (err: any) {
      logger.warn("lifecycle.tape_close_failed", { error: err.message });
    }
    logger.info("phus_agent.disposed");
  };

  return { agent: internals, internals, dispose };
}