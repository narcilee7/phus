// src/bridge/lifecycle.ts
// Async factory + disposal for `PhusAgent`. Replaces the previous
// `void this.loadPluginsAsync()` fire-and-forget pattern.

import {
  PhusAgent,
  type PhusAgentDeps,
  type PhusAgentFacade,
} from "./pi-agent.js";
import { RepoFileIndex } from "@phus/core/session/repo-file-index.js";
import { logger } from "../infra/logging.js";

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
  // Default to a cwd-scoped repo index when none is wired. The index is
  // cheap (a single directory walk) and gives the prompt assembler the
  // file-relevance signal that §D Code Capability calls for.
  const resolvedDeps: PhusAgentDeps = {
    ...deps,
    repoIndex: deps.repoIndex ?? new RepoFileIndex(process.cwd()),
  };
  const internals = new PhusAgent(resolvedDeps);
  // Load plugins before the agent accepts the first turn so skills
  // registered by plugins are discoverable immediately.
  const { loadPlugins } = await import("../infra/plugins/loader.js");
  loadPlugins(internals.hooks, internals.extraChannels, {
    registerRuntime: () => {
      // Runtime skill registration is intentionally not yet supported.
    },
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try { internals.mesh.stopHealthChecks(); } catch { /* ignore */ }
    try { internals.tape.close?.(); } catch (err: any) {
      logger.warn("lifecycle.tape_close_failed", { error: err.message });
    }
    try { internals.planStore.close(); } catch { /* ignore */ }
    logger.info("phus_agent.disposed");
  };

  return { agent: internals, internals, dispose };
}