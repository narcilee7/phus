// src/core/profile.ts
// Provider profile resolution.
//
// A profile bundles everything needed to talk to one provider:
//   - provider key (Pi's registry id, e.g. "anthropic" / "openai")
//   - modelId (canonical id as registered in Pi — used for cost /
//     context-window metadata)
//   - baseUrl + wireId overrides (for OpenAI-compatible gateways
//     where the wire-level model id differs from the canonical one)
//   - per-profile thinking level
//   - per-profile API key source (env var name)
//
// Profiles are configured in `phus.config.yaml` under `providers.profiles.<name>`.
// The active profile is chosen by PHUS_PROFILE env var (default: "default").
// For backward compat, env-var-only mode still works when no config file exists.
//
// Backward compatibility:
//   - Legacy `model: "<provider>/<modelId>"` strings are auto-translated
//     into the new `provider` + `modelId` fields by the loader.
//   - Legacy `modelId: "<wire-id>"` (used as a wire override) is auto-
//     translated into `wireId`. A deprecation warn is emitted so users
//     update their config.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { logger } from "@/infra/logging.js";
import { LlmFuse } from "@/infra/llm-fuse.js";
import { resolveAndCache, validateModelString, loadConfig } from "@/infra/config/index.js";

/** Process-wide LLM fuse (billing circuit + call budgets). Lazily built
 *  so config is read on first use; tests can reset between cases. */
let _llmFuse: LlmFuse | undefined;
export function getLlmFuse(): LlmFuse {
  if (!_llmFuse) {
    _llmFuse = new LlmFuse(() => loadConfig().robustness);
  }
  return _llmFuse;
}
/** Test hook: drop the cached fuse so the next getLlmFuse() re-reads config. */
export function _resetLlmFuse(): void {
  _llmFuse = undefined;
}

export interface ProviderProfile {
  name: string;
  /** Pi provider key (e.g. "anthropic", "openai", "deepseek"). Required. */
  provider: string;
  /** Canonical model id as registered in Pi's registry (e.g. "claude-sonnet-4-20250514"). Required. */
  modelId: string;
  /** Override the provider's default baseUrl. */
  baseUrl?: string;
  /** Override the model id sent on the wire (for gateways with their own id scheme
   *  like Volcano Ark's ep-xxx). Defaults to `modelId` if unset. */
  wireId?: string;
  /** Optional extra headers to send with every request. */
  headers?: Record<string, string>;
  /** API key written directly in the config file (less secure than env vars). */
  apiKey?: string;
  /** Env var name to read the API key from. Defaults to Pi's getEnvApiKey(). */
  apiKeyEnv?: string;
  /** Thinking level for this profile. */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Max tool-use loop steps for this profile. */
  maxSteps?: number;
  /** Per-level thinking token budgets (overrides Pi defaults). */
  thinkingBudgets?: {
    minimal?: number;
    low?: number;
    medium?: number;
    high?: number;
  };
  /** Tool execution strategy: sequential (default) or parallel. B.4.2. */
  toolExecution?: "sequential" | "parallel";
  /** Auto-compact when context exceeds threshold. Default true. */
  autoCompact?: boolean;
  /** Mesh endpoints for cross-provider failover (Phase C). */
  mesh?: MeshSpec[];
  /** Mesh routing strategy when multiple endpoints. Default: failover. */
  meshStrategy?: "failover" | "weighted" | "cost-first" | "latency-first";
  /** Human-readable description for `phus profiles` output. */
  description?: string;
}

export interface MeshSpec {
  name: string;
  /** Pi provider key. Required. */
  provider: string;
  /** Canonical model id. Required. */
  modelId: string;
  /** Optional wire-id override. Defaults to `modelId` if unset. */
  wireId?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  /** Priority for failover. Lower = preferred. Default: 0. */
  priority?: number;
  /** Weight for weighted strategy. Default: 1. */
  weight?: number;
  /** Cost per 1M tokens (USD). */
  costPerMillion?: { input: number; output: number };
  /** Tags (e.g. "premium", "cheap", "china"). */
  tags?: string[];
}

export interface ProviderConfig {
  profiles: Record<string, ProviderProfile>;
  /** Which profile to use when PHUS_PROFILE is unset. */
  defaultProfile?: string;
}

const DEFAULT_PROFILE: Omit<ProviderProfile, "name"> = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-20250514",
  thinkingLevel: "medium",
};

/**
 * Resolve `provider` + `modelId` from explicit fields and/or the legacy
 * `model: "<provider>/<modelId>"` form. Explicit fields win over derived
 * ones. Returns null when the resulting pair is incomplete.
 */
function resolveModelFields(
  raw: Record<string, unknown>,
  context: { profileName?: string; section?: string } = {},
): { provider: string; modelId: string } | null {
  const explicitProvider =
    typeof raw.provider === "string" && raw.provider.length > 0 ? raw.provider : undefined;
  const explicitModelId =
    typeof raw.modelId === "string" && raw.modelId.length > 0 ? raw.modelId : undefined;

  let derived: { provider: string; modelId: string } | undefined;
  if (!explicitProvider || !explicitModelId) {
    const parsed = validateModelString(raw.model, context);
    if (typeof parsed === "object") {
      derived = parsed;
    }
  }

  const provider = explicitProvider ?? derived?.provider;
  const modelId = explicitModelId ?? derived?.modelId;
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

/** Load provider config from $PHUS_HOME/phus.config.yaml (legacy sync
 *  entry point — production code goes through `loadConfig()`).
 *  Backward compatibility: legacy `model: "<provider>/<modelId>"` is
 *  translated into `provider` + `modelId` when explicit fields are
 *  absent. Profiles missing required fields are skipped; downstream
 *  callers that need strict validation should use `loadConfig()`. */
export function loadProviderConfig(home = process.env.PHUS_HOME ?? "./.phus"): ProviderConfig {
  const cfgPath = path.join(home, "phus.config.yaml");
  if (!fs.existsSync(cfgPath)) {
    return { profiles: { default: { ...DEFAULT_PROFILE, name: "default" } }, defaultProfile: "default" };
  }
  try {
    const raw = yaml.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      providers?: { defaultProfile?: string; profiles?: Record<string, Record<string, unknown>> };
    };
    const providers = raw?.providers;
    if (!providers) {
      return { profiles: { default: { ...DEFAULT_PROFILE, name: "default" } }, defaultProfile: "default" };
    }
    const profiles: Record<string, ProviderProfile> = {};
    for (const [name, rawProfile] of Object.entries(providers.profiles ?? {})) {
      const r = rawProfile ?? {};
      const resolved = resolveModelFields(r, { profileName: name });
      if (!resolved) continue;
      const wireId = typeof r.wireId === "string" && r.wireId.length > 0 ? r.wireId : undefined;
      const meshRaw = Array.isArray(r.mesh) ? r.mesh : undefined;
      const mesh = meshRaw
        ? meshRaw
            .map((entry, index) => {
              if (!entry || typeof entry !== "object") return null;
              const mr = entry as Record<string, unknown>;
              const mResolved = resolveModelFields(mr, { profileName: name, section: `mesh[${index}]` });
              if (!mResolved) return null;
              const w = typeof mr.wireId === "string" && mr.wireId.length > 0 ? mr.wireId : undefined;
              return { ...mr, provider: mResolved.provider, modelId: mResolved.modelId, wireId: w } as MeshSpec;
            })
            .filter((m): m is MeshSpec => m !== null)
        : undefined;
      profiles[name] = {
        ...r,
        name,
        provider: resolved.provider,
        modelId: resolved.modelId,
        wireId,
        ...(mesh ? { mesh } : {}),
      } as ProviderProfile;
    }
    if (!profiles.default) profiles.default = { ...DEFAULT_PROFILE, name: "default" };
    return {
      profiles,
      defaultProfile: providers.defaultProfile ?? "default",
    };
  } catch (err) {
    logger.error("provider.config_parse_failed", {
      path: cfgPath,
      error: (err as Error).message,
    });
    return { profiles: { default: { ...DEFAULT_PROFILE, name: "default" } }, defaultProfile: "default" };
  }
}

/** Resolve the active profile by name. */
export function resolveProfile(
  name: string | undefined,
  cfg: ProviderConfig = loadProviderConfig(),
): ProviderProfile {
  const target = name ?? cfg.defaultProfile ?? "default";
  const p = cfg.profiles[target];
  if (!p) {
    const known = Object.keys(cfg.profiles).join(", ");
    throw new Error(
      `Unknown profile "${target}". Known profiles: ${known || "(none)"}. ` +
        `Add it to phus.config.yaml::providers.profiles.${target}`,
    );
  }
  return p;
}

/** Build a Pi Model from a profile, applying overrides.
 *
 *  Delegates to `resolveAndCache()` (validated at config-load time)
 *  so a single (provider, modelId, baseUrl, overrideId) tuple is
 *  resolved once per process. Custom OpenAI-compatible gateways
 *  (modelIds not in Pi's registry) succeed with a synthesized
 *  stub Model. */
export function modelFromProfile(profile: ProviderProfile): Model<any> {
  if (!profile.provider || !profile.modelId) {
    throw new Error(
      `Profile "${profile.name}": missing provider or modelId. ` +
        `Set provider: "<provider>" and modelId: "<modelId>" (or the legacy model: "<provider>/<modelId>").`,
    );
  }
  const wireId = profile.wireId ?? profile.modelId;
  const { model: base } = resolveAndCache({
    provider: profile.provider,
    modelId: profile.modelId,
    baseUrl: profile.baseUrl,
    overrideId: wireId,
  });

  const overrides: Partial<Model<any>> & { headers?: Record<string, string> } = {};
  if (profile.baseUrl) overrides.baseUrl = profile.baseUrl;
  if (wireId !== profile.modelId) {
    overrides.id = wireId;
    // Gateway proxies (Volcano Ark, etc.) may not support the native
    // thinking/reasoning API. Disable reasoning so Pi doesn't send
    // unsupported parameters like `thinking: { type: "disabled" }`.
    overrides.reasoning = false;
  }
  if (profile.headers) overrides.headers = { ...base.headers, ...profile.headers };

  return Object.keys(overrides).length > 0 ? { ...base, ...overrides } : base;
}

/** Read the API key for a profile (explicit key > env var > Pi auto-detect). */
export function apiKeyForProfile(profile: ProviderProfile): string | undefined {
  if (profile.apiKey) return profile.apiKey;
  if (profile.apiKeyEnv) return process.env[profile.apiKeyEnv];
  return profile.provider ? getEnvApiKey(profile.provider) : undefined;
}

/** Pretty-print all profiles (for `phus profiles`). */
export function formatProfiles(cfg: ProviderConfig = loadProviderConfig()): string {
  const names = Object.keys(cfg.profiles);
  if (names.length === 0) return "(no profiles)";
  const lines: string[] = [];
  for (const name of names) {
    const p = cfg.profiles[name]!;
    const isDefault = name === (cfg.defaultProfile ?? "default");
    const mark = isDefault ? "★" : " ";
    const desc = p.description ? ` — ${p.description}` : "";
    const overrides: string[] = [];
    if (p.baseUrl) overrides.push(`baseUrl=${p.baseUrl}`);
    if (p.wireId && p.wireId !== p.modelId) overrides.push(`wireId=${p.wireId}`);
    if (p.thinkingLevel) overrides.push(`thinking=${p.thinkingLevel}`);
    const ov = overrides.length ? ` (${overrides.join(", ")})` : "";
    lines.push(`${mark} ${name}: ${p.provider}/${p.modelId}${ov}${desc}`);
  }
  return lines.join("\n");
}