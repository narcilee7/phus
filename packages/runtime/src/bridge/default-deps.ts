// src/bridge/default-deps.ts
// Compose a `PhusAgentDeps` from config + active profile.
// Used by CLI / TUI / commands that want a turnkey agent without
// manually wiring every dependency.

import { HookRegistry } from "@phus/core/runtime/hook/registry.js";
import { Tape } from "@phus/core/session/tape.js";
import { SkillRegistry } from "@/infra/skills/registry.js";
import { defaultPolicy } from "@/infra/safety.js";
import { resolveProfile, type ProviderProfile } from "@/infra/profile.js";
import {
  type EndpointSpec,
  type MeshPolicy,
} from "@/llm/provider-mesh/index.js";
import { PiSteeringInbox } from "@phus/core/runtime/steering/index.js";
import type { SteeringInbox } from "@phus/core/types/steering/index.js";
import { buildMesh } from "@/llm/provider-mesh/index.js";
import type { MeshLike } from "@/llm/provider-mesh/contract.js";
import { logger } from "@/infra/logging.js";
import { resolveModelSafe } from "@/bridge/model-resolver.js";
import type { PhusAgentDeps } from "@/bridge/pi-agent.js";
import { loadConfig, type ResolvedConfig } from "@/infra/config/index.js";
import { MemoryStore, AutonomyGate } from "@/infra/memory/index.js";
import { PlanStore } from "@phus/core/session/plan-store.js";
import * as path from "node:path";

export interface DefaultDepsOptions {
  /** Force a specific profile (e.g. `phus run --profile foo`). */
  profileName?: string;
  /** Pre-loaded config; falls back to `loadConfig()` if not passed. */
  config?: ResolvedConfig;
  /** If true, allow creating deps even when no API key is configured. */
  allowMissingKey?: boolean;
}

/** Build the `PhusAgentDeps` from the active profile and config.
 *  Pass `config` when calling from a bootstrap path that already loaded
 *  it (avoids the redundant parse). Direct callers can omit it. */
export function buildDefaultPhusAgentDeps(opts: DefaultDepsOptions = {}): PhusAgentDeps {
  const config = opts.config ?? loadConfig();
  const profileName = opts.profileName ?? config.profileName;
  const profile: ProviderProfile = resolveProfile(profileName, config.providers);
  const tape = new Tape(config.paths.tapeDb);
  const skills = new SkillRegistry(config.paths.skillsDir);
  const memoryStore = new MemoryStore(config.paths.memoryFile);
  const autonomyGate = AutonomyGate.fromConfig(config.memory);
  const policy = defaultPolicy();
  const hooks = new HookRegistry({ isolateErrors: true });

  const endpoints: EndpointSpec[] = profile.mesh && profile.mesh.length > 0
    ? profile.mesh.map((m) => ({
        name: m.name,
        provider: m.provider,
        modelId: m.modelId,
        baseUrl: m.baseUrl,
        apiKeyEnv: m.apiKeyEnv,
        priority: m.priority,
        weight: m.weight,
        costPerMillion: m.costPerMillion,
        tags: m.tags,
      }))
    : [{
        name: profile.name,
        provider: profile.provider,
        modelId: profile.modelId,
        baseUrl: profile.baseUrl,
        apiKeyEnv: profile.apiKeyEnv,
        priority: 0,
      }];
  const meshPolicy: MeshPolicy = { strategy: profile.meshStrategy ?? "failover" };
  const mesh: MeshLike = buildMesh(endpoints, meshPolicy);

  // Warm the API-key env var when available. We use the safe variant so
  // the CLI/TUI can boot without a key and prompt the user later.
  const { model: resolvedModel, missingKey } = resolveModelSafe();
  if (missingKey && !opts.allowMissingKey) {
    const envVar = profile.apiKeyEnv ?? `${profile.provider?.toUpperCase().replace(/-/g, "_") ?? "PROVIDER"}_API_KEY`;
    throw new Error(
      `No API key configured for profile "${profileName}".\n` +
        `Run \`phus setup\` to configure a provider and key, or set:\n` +
        `  export ${envVar}=<your-key>`,
    );
  }

  const steeringInbox: SteeringInbox = new PiSteeringInbox();

  const planStore = new PlanStore(path.join(config.paths.home, "plans.sqlite"));
  // Planner/Verifier/Learner are constructed inside PhusAgent from the
  // injected `corePort`. Default-deps no longer needs to build them.

  return {
    logger,
    tape,
    skills,
    memoryStore,
    autonomyGate,
    hooks,
    mesh,
    steeringInbox,
    profile,
    policy,
    planStore,
  };
}
