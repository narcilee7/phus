// src/bridge/model-resolver.ts
// Resolve the Pi Model and API key for a provider profile.

import { getModel, type Model } from "@mariozechner/pi-ai";
import { resolveProfile, modelFromProfile, apiKeyForProfile, type ProviderProfile } from "@/infra/profile.js";
import { loadConfig } from "@/infra/config/index.js";

/** Build a Pi-compatible `Model` from the active profile, also setting
 *  any `<PROVIDER>_API_KEY` env var so Pi's transport picks it up. */
export function resolveModel(): Model<any> {
  const profileName = loadConfig().profileName;
  const profile = resolveProfile(profileName);
  const model = modelFromProfile(profile);
  const key = apiKeyForProfile(profile);
  if (key) {
    const provider = profile.provider;
    if (provider) {
      const envKey = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      process.env[envKey] ??= key;
    }
  }
  return model;
}

/** Look up an API key for a provider, falling back through:
 *  1. `profile.apiKeyEnv` from the active profile
 *  2. A small hard-coded map of well-known provider → env var
 *  3. The `<PROVIDER>_API_KEY` convention */
export function resolveApiKey(provider: string): string | undefined {
  try {
    const profile: ProviderProfile = resolveProfile(loadConfig().profileName);
    if (profile.apiKeyEnv && process.env[profile.apiKeyEnv]) {
      return process.env[profile.apiKeyEnv];
    }
  } catch { /* ignore — fall through to env map */ }
  const envMap: Record<string, string> = {
    "github-copilot": "COPILOT_GITHUB_TOKEN",
    anthropic: "ANTHROPIC_OAUTH_TOKEN",
  };
  const direct = envMap[provider];
  if (direct && process.env[direct]) return process.env[direct];
  const upperKey = `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  return process.env[upperKey];
}