// src/core/profile.ts
// Provider profile resolution.
//
// A profile bundles everything needed to talk to one provider:
//   - which Pi-registered model to use (for cost / context-window metadata)
//   - baseUrl + modelId overrides (for OpenAI-compatible gateways)
//   - per-profile thinking level
//   - per-profile API key source (env var name)
//
// Profiles are configured in `phus.config.yaml` under `providers.profiles.<name>`.
// The active profile is chosen by PHUS_PROFILE env var (default: "default").
// For backward compat, env-var-only mode still works when no config file exists.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { logger } from "@/infra/logging.js";

export interface ProviderProfile {
  name: string;
  /** <provider>/<modelId> as registered in Pi. */
  model: string;
  /** Override the provider's default baseUrl. */
  baseUrl?: string;
  /** Override the model id sent on the wire (for gateways with their own id scheme). */
  modelId?: string;
  /** Optional extra headers to send with every request. */
  headers?: Record<string, string>;
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
  provider: string;
  modelId: string;
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

const DEFAULT_PROFILE: ProviderProfile = {
  name: "default",
  model: "anthropic/claude-sonnet-4-20250514",
  thinkingLevel: "medium",
};

/** Load provider config from $PHUS_HOME/phus.config.yaml (legacy sync
 *  entry point — production code goes through `loadConfig()`). */
export function loadProviderConfig(home = process.env.PHUS_HOME ?? "./.phus"): ProviderConfig {
  const cfgPath = path.join(home, "phus.config.yaml");
  if (!fs.existsSync(cfgPath)) {
    return { profiles: { default: { ...DEFAULT_PROFILE, name: "default" } }, defaultProfile: "default" };
  }
  try {
    const raw = yaml.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      providers?: ProviderConfig;
    };
    const providers = raw?.providers;
    if (!providers) {
      return { profiles: { default: { ...DEFAULT_PROFILE, name: "default" } }, defaultProfile: "default" };
    }
    const profiles: Record<string, ProviderProfile> = {};
    for (const [name, p] of Object.entries(providers.profiles ?? {})) {
      profiles[name] = { ...p, name };
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

/** Build a Pi Model from a profile, applying overrides. */
export function modelFromProfile(profile: ProviderProfile): Model<any> {
  const [provider, modelId] = profile.model.split("/", 2);
  if (!provider || !modelId) {
    throw new Error(
      `Profile "${profile.name}": invalid model "${profile.model}". Expected "<provider>/<modelId>".`,
    );
  }
  const base = getModel(provider as any, modelId as any);

  const overrides: Partial<Model<any>> & { headers?: Record<string, string> } = {};
  if (profile.baseUrl) overrides.baseUrl = profile.baseUrl;
  if (profile.modelId) overrides.id = profile.modelId;
  if (profile.headers) overrides.headers = { ...base.headers, ...profile.headers };

  return Object.keys(overrides).length > 0 ? { ...base, ...overrides } : base;
}

/** Read the API key for a profile (explicit env var > Pi auto-detect). */
export function apiKeyForProfile(profile: ProviderProfile): string | undefined {
  if (profile.apiKeyEnv) return process.env[profile.apiKeyEnv];
  // Pi's auto-detect: derive provider from profile.model prefix
  const provider = profile.model.split("/", 1)[0];
  return provider ? getEnvApiKey(provider) : undefined;
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
    if (p.modelId) overrides.push(`modelId=${p.modelId}`);
    if (p.thinkingLevel) overrides.push(`thinking=${p.thinkingLevel}`);
    const ov = overrides.length ? ` (${overrides.join(", ")})` : "";
    lines.push(`${mark} ${name}: ${p.model}${ov}${desc}`);
  }
  return lines.join("\n");
}
