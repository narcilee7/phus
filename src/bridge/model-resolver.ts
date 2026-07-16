// src/bridge/model-resolver.ts
// Resolve the Pi Model and API key for a provider profile.

import { getModel, type Model } from "@mariozechner/pi-ai";
import { resolveProfile, modelFromProfile, apiKeyForProfile, type ProviderProfile } from "@/infra/profile.js";
import { loadConfig } from "@/infra/config/index.js";

function providerApiKeyEnvVar(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

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
      process.env[providerApiKeyEnvVar(provider)] ??= key;
    }
    return model;
  }

  // No key found: build a helpful message based on how the profile is configured.
  const provider = profile.provider;
  const envVar = provider ? providerApiKeyEnvVar(provider) : "<PROVIDER>_API_KEY";
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
      `  export ${envVar}=<your-key>\n` +
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