// src/infra/config/schema.ts
// Public types for the unified config loader.
//
// The shape mirrors the YAML layout (paths, log, providers, plugins,
// schedules) so the file IS the API. Adding a new top-level YAML
// section means adding it here + in loader.ts.

import type { ProviderConfig } from "@/infra/profile.js";
import type { Schedule } from "@/types/scheduler/index.js";
import type { LogLevelLiteral } from "./defaults.js";

/** Resolved filesystem paths. */
export interface PathsConfig {
  home: string;
  tapeDb: string;
  skillsDir: string;
}

/** Resolved logger config. */
export interface LogConfig {
  file: string;
  level: LogLevelLiteral;
}

/**
 * PluginSpec as it appears in `phus.config.yaml::plugins`. The plugin
 * loader converts each entry into a LoadedPlugin; this is the parsed
 * input shape.
 */
export interface PluginSpec {
  name?: string;
  path: string;
  config?: unknown;
}

/**
 * Fully-resolved, interpolated, cached config — what every consumer
 * reads via `loadConfig()`. Re-loading returns the same object until
 * the file changes or `resetConfigCache()` is called.
 */
export interface ResolvedConfig {
  paths: PathsConfig;
  log: LogConfig;
  providers: ProviderConfig;
  plugins: PluginSpec[];
  schedules: Schedule[];
  /** Active profile name (env > YAML > default). */
  profileName: string;
  /** Interpolated YAML tree, exposed for plugin `register(ctx)` to read arbitrary sections. */
  raw: unknown;
  /** Where this config came from. */
  source: { path: string; mtimeMs: number; present: boolean };
}

/** Variables for which an env override is still honored (one-release deprecation window). */
export const ENV_OVERRIDE_VARS = [
  "PHUS_HOME",
  "PHUS_LOG_FILE",
  "PHUS_LOG_LEVEL",
  "PHUS_PROFILE",
] as const;

export type EnvOverrideVar = (typeof ENV_OVERRIDE_VARS)[number];