// apps/gui/src/main/bootstrap.ts
// Detect whether the user needs to run the BootstrapWizard (no config) or
// the KeyWizard (config exists but no API key). Mirrors the logic in
// src/tui/index.ts but stays GUI-only.
//
// `loadConfig()` is intentionally called defensively — if the file is
// malformed we surface a bootstrap-needed signal so the renderer can
// walk the user through recovery.

import type { BootstrapStatusPayload } from "../shared/ipc-schema.js";

interface DetectResult {
  needsBootstrap: boolean;
  needsKey: boolean;
  hasConfig: boolean;
  profileName?: string;
  provider?: string;
  apiKeyEnv?: string;
  suggestedEnvVar?: string;
}

/** Inspect the on-disk config + active profile + env vars. Return the
 *  wizard state the renderer should render (or none if everything is ready). */
export async function detectBootstrapState(): Promise<BootstrapStatusPayload> {
  try {
    const { loadConfig } = await import("@root/infra/config/index.js");
    const { resolveProfile, apiKeyForProfile } = await import(
      "@root/infra/profile.js"
    );

    let config: Awaited<ReturnType<typeof loadConfig>>;
    try {
      config = loadConfig();
    } catch {
      // Malformed YAML → treat as missing and let bootstrap rebuild it.
      return {
        needsBootstrap: true,
        needsKey: false,
        hasConfig: false,
      };
    }

    if (!config.source.present) {
      return {
        needsBootstrap: true,
        needsKey: false,
        hasConfig: false,
      };
    }

    const profile = resolveProfile(config.profileName, config.providers);
    const hasKey = !!apiKeyForProfile(profile);
    if (hasKey) {
      return {
        needsBootstrap: false,
        needsKey: false,
        hasConfig: true,
        profileName: config.profileName,
        provider: profile.provider,
        apiKeyEnv: profile.apiKeyEnv,
      };
    }

    const suggestedEnvVar =
      profile.apiKeyEnv ??
      `${profile.provider?.toUpperCase().replace(/-/g, "_") ?? "PROVIDER"}_API_KEY`;

    return {
      needsBootstrap: false,
      needsKey: true,
      hasConfig: true,
      profileName: config.profileName,
      provider: profile.provider,
      apiKeyEnv: profile.apiKeyEnv,
      suggestedEnvVar,
    };
  } catch (err) {
    // Any unexpected error → safer to force bootstrap so user sees something
    // rather than a blank window.
    console.error("[phus-gui] detectBootstrapState failed:", err);
    return {
      needsBootstrap: true,
      needsKey: false,
      hasConfig: false,
    };
  }
}

/** Persist a wizard submission to phus.config.yaml. Used by both bootstrap
 *  (create new profile) and key (update existing profile's apiKey). */
export async function writeBootstrapConfig(
  payload: import("../shared/ipc-schema.js").BootstrapSubmitPayload,
): Promise<{ home: string; configPath: string }> {
  const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const yaml = (await import("yaml")).default;

  const home = process.env["PHUS_HOME"];
  if (!home) {
    throw new Error("[phus-gui] PHUS_HOME not set; call redirectPhusPaths() first");
  }
  const configPath = join(home, "phus.config.yaml");

  type ProviderProfileYaml = {
    name: string;
    provider: string;
    modelId: string;
    apiKey?: string;
    apiKeyEnv?: string;
  };
  type ProvidersYaml = {
    defaultProfile?: string;
    profiles: Record<string, ProviderProfileYaml>;
  };
  type RootYaml = {
    providers?: ProvidersYaml;
    memory?: Record<string, unknown>;
  };

  let existing: RootYaml = {};
  if (existsSync(configPath)) {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(configPath, "utf8");
    existing = (yaml.parse(raw) as RootYaml | null) ?? {};
  }
  if (!existing.providers) existing.providers = { profiles: {} };
  if (!existing.providers.profiles) existing.providers.profiles = {};

  const profile: ProviderProfileYaml = {
    name: payload.profileName,
    provider: payload.provider,
    modelId: payload.modelId,
  };

  if (payload.apiKeyMode === "inline" && payload.apiKey) {
    profile.apiKey = payload.apiKey;
  } else {
    profile.apiKeyEnv =
      `${payload.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  }

  existing.providers.profiles[payload.profileName] = profile;
  existing.providers.defaultProfile = payload.profileName;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, yaml.stringify(existing), "utf8");

  return { home, configPath };
}