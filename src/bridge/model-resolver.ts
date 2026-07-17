// src/bridge/model-resolver.ts
// Resolve the Pi Model and API key for a provider profile.

import { getModel, type Model } from "@mariozechner/pi-ai";
import { resolveProfile, modelFromProfile, apiKeyForProfile, type ProviderProfile } from "@/infra/profile.js";
import { loadConfig } from "@/infra/config/index.js";

function providerApiKeyEnvVar(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

export interface ModelResolution {
  model: Model<any>;
  /** If set, the API key could not be found; value is the env var the user should set. */
  missingKey?: string;
}

/** Build a Pi-compatible `Model` from the active profile, also setting
 *  any `<PROVIDER>_API_KEY` env var so Pi's transport picks it up.
 *  Does NOT throw when the key is missing; callers that need a hard
 *  failure should check `missingKey` or use `resolveModel()`. */
export function resolveModelSafe(): ModelResolution {
  const profileName = loadConfig().profileName;
  const profile = resolveProfile(profileName);
  const model = modelFromProfile(profile);
  const key = apiKeyForProfile(profile);

  if (key) {
    const provider = profile.provider;
    if (provider) {
      process.env[providerApiKeyEnvVar(provider)] ??= key;
    }
    return { model };
  }

  const provider = profile.provider;
  const missingKey = profile.apiKeyEnv
    ? profile.apiKeyEnv
    : provider
      ? providerApiKeyEnvVar(provider)
      : "<PROVIDER>_API_KEY";
  return { model, missingKey };
}

/** Build a Pi-compatible `Model` from the active profile. Throws a
 *  helpful error if no API key is configured. */
export function resolveModel(): Model<any> {
  const { model, missingKey } = resolveModelSafe();
  if (!missingKey) return model;

  const profileName = loadConfig().profileName;
  const profile = resolveProfile(profileName);
  if (profile.apiKeyEnv) {
    throw new Error(
      `Profile "${profileName}" reads its API key from the environment variable "${profile.apiKeyEnv}", ` +
        `but that variable is not set. Either export it:\n` +
        `  export ${profile.apiKeyEnv}=<your-key>\n` +
        `or write the key directly in phus.config.yaml (less secure):\n` +
        `  apiKey: <your-key>`,
    );
  }
  throw new Error(
    `Profile "${profileName}" has no API key. Set the environment variable:\n` +
      `  export ${missingKey}=<your-key>\n` +
      `or write the key directly in phus.config.yaml (less secure):\n` +
      `  apiKey: <your-key>`,
  );
}

/** Look up an API key for a provider, falling back through:
 *  1. `profile.apiKey` from the active profile
 *  2. `profile.apiKeyEnv` from the active profile
 *  3. A small hard-coded map of well-known provider → env var
 *  4. The `<PROVIDER>_API_KEY` convention */
export function resolveApiKey(provider: string): string | undefined {
  try {
    const profile: ProviderProfile = resolveProfile(loadConfig().profileName);
    return apiKeyForProfile(profile);
  } catch { /* ignore — fall through to env map */ }
  const envMap: Record<string, string> = {
    "github-copilot": "COPILOT_GITHUB_TOKEN",
    anthropic: "ANTHROPIC_OAUTH_TOKEN",
  };
  const direct = envMap[provider];
  if (direct && process.env[direct]) return process.env[direct];
  return process.env[providerApiKeyEnvVar(provider)];
}