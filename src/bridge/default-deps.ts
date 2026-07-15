// src/bridge/default-deps.ts
// Compose a `PhusAgentDeps` from process env + on-disk config.
// Used by CLI / TUI / commands that want a turnkey agent without
// manually wiring every dependency.

import { HookRegistry } from "@/core/runtime/hook.js";
import { Tape } from "@/core/session/tape.js";
import { SkillRegistry } from "@/core/runtime/skills/skill.js";
import { defaultPolicy } from "@/core/llm/policy.js";
import { resolveProfile, type ProviderProfile } from "@/core/llm/profile.js";
import {
  ProviderMesh,
  type EndpointSpec,
  type MeshPolicy,
} from "@/core/llm/provider-mesh/index.js";
import type { MeshLike } from "@/core/llm/provider-mesh/contract.js";
import { PiSteeringInbox } from "@/core/runtime/steering.js";
import type { SteeringInbox } from "@/types/steering/index.js";
import { buildMesh } from "@/core/llm/provider-mesh/index.js";
import { logger } from "@/core/runtime/logger.js";
import { resolveModel } from "@/bridge/model-resolver.js";
import type { PhusAgentDeps } from "@/bridge/pi-agent.js";

export interface DefaultDepsOptions {
  /** Force a specific profile (e.g. `phus run --profile foo`). */
  profileName?: string;
}

/** Build the `PhusAgentDeps` from the active profile and on-disk
 *  config. The mesh is registered with `setMeshSingleton` for
 *  diagnostic commands that still go through the legacy accessor;
 *  Phase 5 will retire that singleton entirely. */
export function buildDefaultPhusAgentDeps(opts: DefaultDepsOptions = {}): PhusAgentDeps {
  if (opts.profileName) process.env.PHUS_PROFILE = opts.profileName;

  const profile: ProviderProfile = resolveProfile(process.env.PHUS_PROFILE);
  const tape = new Tape();
  const skills = new SkillRegistry();
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
        provider: profile.model.split("/", 1)[0]!,
        modelId: profile.modelId ?? profile.model.split("/", 2)[1]!,
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

  return {
    logger,
    tape,
    skills,
    hooks,
    mesh,
    steeringInbox,
    profile,
    policy,
  };
}