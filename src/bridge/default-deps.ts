// src/bridge/default-deps.ts
// Compose a `PhusAgentDeps` from config + active profile.
// Used by CLI / TUI / commands that want a turnkey agent without
// manually wiring every dependency.

import { HookRegistry } from "@/core/runtime/hook.js";
import { Tape } from "@/core/session/tape.js";
import { SkillRegistry } from "@/infra/skills/registry.js";
import { defaultPolicy } from "@/infra/safety.js";
import { resolveProfile, type ProviderProfile } from "@/infra/profile.js";
import {
  type EndpointSpec,
  type MeshPolicy,
} from "@/core/llm/provider-mesh/index.js";
import type { MeshLike } from "@/core/llm/provider-mesh/contract.js";
import { PiSteeringInbox } from "@/core/runtime/steering.js";
import type { SteeringInbox } from "@/types/steering/index.js";
import { buildMesh } from "@/core/llm/provider-mesh/index.js";
import { logger } from "@/infra/logging.js";
import { resolveModel } from "@/bridge/model-resolver.js";
import type { PhusAgentDeps } from "@/bridge/pi-agent.js";
import { loadConfig, type ResolvedConfig } from "@/infra/config/index.js";
import { MemoryStore, AutonomyGate } from "@/infra/memory/index.js";
import { PlanStore } from "@/core/session/plan-store.js";
import { Planner } from "@/core/runtime/planner.js";
import { createPlannerModel } from "@/core/runtime/planner-model.js";
import { modelFromProfile } from "@/infra/profile.js";
import * as path from "node:path";

export interface DefaultDepsOptions {
  /** Force a specific profile (e.g. `phus run --profile foo`). */
  profileName?: string;
  /** Pre-loaded config; falls back to `loadConfig()` if not passed. */
  config?: ResolvedConfig;
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

  // Warm the API-key env var the first time we have a profile.
  // resolveModel() is the canonical place — keeps behavior consistent.
  resolveModel();

  const steeringInbox: SteeringInbox = new PiSteeringInbox();

  const planStore = new PlanStore(path.join(config.paths.home, "plans.sqlite"));
  const planner = new Planner({
    skills,
    model: createPlannerModel(modelFromProfile(profile)),
    hooks,
  });

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
    planner,
  };
}