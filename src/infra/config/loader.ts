// src/infra/config/loader.ts
// The single cached loader for `$PHUS_HOME/phus.config.yaml`.
//
// All 30+ env-var read sites in the codebase collapse to `loadConfig()`
// calls after this lands. See `documents/Architecture.md` for the
// precedence table and `infra/config/schema.ts` for the shape.
//
// Loading flow:
//   1. Resolve home = process.env.PHUS_HOME ?? DEFAULTS.home
//   2. Read <home>/phus.config.yaml; missing file → defaults-filled cfg
//   3. yaml.parse, then interpolateEnv() once
//   4. Build ResolvedConfig with env-override precedence for ops vars
//   5. Cache by mtimeMs; resetConfigCache() invalidates for tests
//
// Side effects: emits `config.file_missing`, `config.interpolate_unset`,
// `config.interpolate_cycle`, and `config.env_override_used` log events.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import { DEFAULTS, LOG_LEVELS, type LogLevelLiteral } from "./defaults.js";
import { interpolateEnv } from "./interpolate.js";
import type {
  EnvOverrideVar,
  LogConfig,
  PathsConfig,
  PluginSpec,
  ResolvedConfig,
} from "./schema.js";
import { ENV_OVERRIDE_VARS } from "./schema.js";
import type { ProviderConfig, ProviderProfile } from "@/infra/profile.js";
import type { Schedule } from "@/types/scheduler/index.js";
import { asScheduleName } from "@/types/brand.js";
import {
  looksLikeSecret,
  resolveAndCache,
  validateMeshEntry,
  validateModelString,
} from "./validate.js";

interface CacheEntry {
  config: ResolvedConfig;
  mtimeMs: number;
  /** Set of env-override vars we've already warned about. */
  warnedOverrides: Set<string>;
}

let _cache: CacheEntry | undefined;

/**
 * Default warn sink: a noop. Replaced by `setLogSink()` from `phus.ts`
 * once pino is up. Tests can call `setLogSink()` with their own
 * recorder to assert log emissions.
 */
let _logSink: (event: string, fields: Record<string, unknown>) => void = () => {};

/**
 * Install the warn sink used for config diagnostics. Called once from
 * `src/phus.ts` after the logger is initialized; safe to call multiple
 * times.
 */
export function setLogSink(
  fn: (event: string, fields: Record<string, unknown>) => void,
): void {
  _logSink = fn;
}

interface LoadOptions {
  /** Force re-read even if mtime matches. */
  forceReload?: boolean;
  /** Override the logger callback (per-call). Useful for tests. */
  warn?: (event: string, fields: Record<string, unknown>) => void;
}

/**
 * Resolve the active config. Memoized by file mtime; pass `forceReload`
 * to bypass. Call `resetConfigCache()` from test `beforeEach` to
 * guarantee isolation between cases.
 */
export function loadConfig(opts: LoadOptions = {}): ResolvedConfig {
  const warn = opts.warn ?? _logSink;
  const home = process.env.PHUS_HOME ?? DEFAULTS.home;
  const cfgPath = path.join(home, "phus.config.yaml");

  let present = false;
  let mtimeMs = 0;
  if (fs.existsSync(cfgPath)) {
    present = true;
    try {
      mtimeMs = fs.statSync(cfgPath).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
  }

  if (
    _cache &&
    !opts.forceReload &&
    _cache.mtimeMs === mtimeMs &&
    _cache.config.source.path === cfgPath
  ) {
    return _cache.config;
  }

  if (!present) {
    // First-run / no-file path: silent at info — not an error condition.
    // We don't emit `config.file_missing` here because the logger may
    // not be initialized yet; tests that want to assert it can pass
    // their own warn sink.
    warn("config.file_missing", { path: cfgPath, using: "defaults" });
  }

  const warnedOverrides = _cache?.warnedOverrides ?? new Set<string>();

  let parsed: unknown = {};
  if (present) {
    try {
      const raw = fs.readFileSync(cfgPath, "utf-8");
      parsed = yaml.parse(raw) ?? {};
    } catch (err) {
      warn("config.parse_failed", {
        path: cfgPath,
        error: err instanceof Error ? err.message : String(err),
      });
      parsed = {};
    }
  }

  // Interpolate `${VAR}` and `$VAR` references. The interpolator warns
  // about unset vars and cycles through the same warn sink.
  const interpolated = interpolateEnv(parsed, { warn, source: cfgPath });

  // Build paths
  const paths: PathsConfig = {
    home,
    tapeDb: getPathField(interpolated, "tapeDb", DEFAULTS.tapeDb),
    skillsDir: getPathField(interpolated, "skillsDir", DEFAULTS.skillsDir),
  };

  // Build log config (env overrides still win for ops vars)
  const logFile = envOrYaml(
    "PHUS_LOG_FILE",
    getPathField(interpolated, "file", DEFAULTS.logFile, "log"),
    warn,
    warnedOverrides,
  );
  const logLevelRaw = envOrYaml(
    "PHUS_LOG_LEVEL",
    getLevelField(interpolated, DEFAULTS.logLevel),
    warn,
    warnedOverrides,
  );
  const logLevel: LogLevelLiteral = (LOG_LEVELS as readonly string[]).includes(logLevelRaw)
    ? (logLevelRaw as LogLevelLiteral)
    : DEFAULTS.logLevel;
  const log: LogConfig = { file: logFile, level: logLevel };

  // Providers — parsed inline to avoid a circular dep with
  // infra/profile.ts (which has its own legacy sync loader for tests
  // and external callers).
  const providers = parseProvidersFromTree(interpolated);

  // Load-time validation: structural checks + model registration.
  // Runs after parseProvidersFromTree so the cache for resolveAndCache
  // is populated for every (provider, modelId) the config references.
  validateProvidersTree(providers, warn, cfgPath);

  // Plugins
  const pluginsRaw = (interpolated as { plugins?: unknown })?.plugins;
  const plugins: PluginSpec[] = parsePluginSpec(pluginsRaw);

  // Schedules
  const schedulesRaw = (interpolated as { schedules?: unknown })?.schedules;
  const schedules: Schedule[] = parseSchedules(schedulesRaw);

  // Active profile (env wins)
  const profileName =
    process.env.PHUS_PROFILE ??
    (interpolated as { providers?: { defaultProfile?: string } })?.providers?.defaultProfile ??
    DEFAULTS.defaultProfile;
  if (process.env.PHUS_PROFILE && !warnedOverrides.has("PHUS_PROFILE")) {
    warnedOverrides.add("PHUS_PROFILE");
    warn("config.env_override_used", { var: "PHUS_PROFILE", value: process.env.PHUS_PROFILE });
  }

  const config: ResolvedConfig = {
    paths,
    log,
    providers,
    plugins,
    schedules,
    profileName,
    raw: interpolated,
    source: { path: cfgPath, mtimeMs, present },
  };

  _cache = { config, mtimeMs, warnedOverrides };
  return config;
}

/** Invalidate the cache (test helper, also used after writes). */
export function resetConfigCache(): void {
  _cache = undefined;
}

/** Returns the absolute path the loader would read (file may not exist). */
export function configPath(): string {
  const home = process.env.PHUS_HOME ?? DEFAULTS.home;
  return path.join(home, "phus.config.yaml");
}

// ─── helpers ───────────────────────────────────────────────────────

function getPathField(
  interpolated: unknown,
  name: string,
  fallback: string,
  section: "paths" | "log" = "paths",
): string {
  const obj = (interpolated as Record<string, unknown> | undefined)?.[section] as
    | Record<string, unknown>
    | undefined;
  const v = obj?.[name];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function getLevelField(interpolated: unknown, fallback: LogLevelLiteral): string {
  const obj = (interpolated as { log?: { level?: unknown } } | undefined)?.log;
  const v = obj?.level;
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Walk every provider profile + mesh entry and validate. Populates
 * the model-resolution cache (used downstream by model-builder.ts
 * and pi-agent.ts so they share a single resolveAndCache() call
 * per (provider, modelId, baseUrl, overrideId) tuple).
 *
 * Throws on structurally invalid model strings (missing "/" etc.)
 * so the user sees the error at `phus run` instead of at first turn.
 * Emits warn (not throw) for unknown Pi registry entries — those
 * are legitimate OpenAI-compatible gateway modelIds (Volcano Ark,
 * Azure, vLLM) that Pi never registered.
 */
function validateProvidersTree(
  providers: ProviderConfig,
  warn: (event: string, fields: Record<string, unknown>) => void,
  cfgPath: string,
): void {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [profileName, profile] of Object.entries(providers.profiles)) {
    // Skip the synthetic fallback profile — no model to validate.
    if (profile === providers.profiles.default && Object.keys(providers.profiles).length === 1) {
      // Synthetic default with no user config — only validate if mesh exists.
      if (!profile.mesh || profile.mesh.length === 0) continue;
    }

    // 1. Validate profile.model string format
    const parsed = validateModelString(profile.model, { profileName });
    if (typeof parsed === "string") {
      errors.push(`${cfgPath}: ${parsed}`);
      continue;
    }
    // 2. Resolve via Pi registry (or synthesize for unknown gateways)
    const resolution = resolveAndCache({
      provider: parsed.provider,
      modelId: parsed.modelId,
      baseUrl: profile.baseUrl,
      overrideId: profile.modelId,
    });
    if (!resolution.inRegistry) {
      const cacheKey = `${parsed.provider}|${parsed.modelId}`;
      if (!seen.has(cacheKey)) {
        seen.add(cacheKey);
        warn("config.model.not_in_registry", {
          provider: parsed.provider,
          modelId: parsed.modelId,
          profile: profileName,
          source: cfgPath,
          hint: profile.baseUrl
            ? "custom gateway endpoint — this is expected if baseUrl is an OpenAI-compatible gateway"
            : "no baseUrl set — verify the provider name and model id are correct",
        });
      }
    }

    // 3. apiKeyEnv secret-in-yaml heuristic
    const secretHint = looksLikeSecret(profile.apiKeyEnv);
    if (secretHint) {
      warn("config.apiKeyEnv.looks_like_secret", {
        profile: profileName,
        apiKeyEnv: profile.apiKeyEnv,
        reason: secretHint,
        source: cfgPath,
      });
    }

    // 4. Validate each mesh entry
    if (profile.mesh) {
      for (let i = 0; i < profile.mesh.length; i++) {
        const entry = validateMeshEntry(profile.mesh[i], i, { profileName });
        if (typeof entry === "string") {
          errors.push(`${cfgPath}: ${entry}`);
          continue;
        }
        const meshResolution = resolveAndCache({
          provider: entry.provider,
          modelId: entry.modelId,
          baseUrl: profile.mesh?.[i]?.baseUrl,
          overrideId: profile.mesh?.[i]?.modelId,
        });
        const cacheKey = `${entry.provider}|${entry.modelId}`;
        if (!meshResolution.inRegistry && !seen.has(cacheKey)) {
          seen.add(cacheKey);
          warn("config.model.not_in_registry", {
            provider: entry.provider,
            modelId: entry.modelId,
            profile: profileName,
            meshIndex: i,
            source: cfgPath,
            hint: profile.mesh?.[i]?.baseUrl
              ? "custom gateway endpoint — expected for OpenAI-compatible gateways"
              : "no baseUrl set — verify the provider name and model id are correct",
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
}

/** Thrown by validateProvidersTree when the YAML has structural errors. */
export class ConfigValidationError extends Error {
  override readonly name = "ConfigValidationError";
  constructor(public readonly errors: string[]) {
    super(`phus.config.yaml has ${errors.length} validation error(s):\n  - ${errors.join("\n  - ")}`);
  }
}

function envOrYaml(
  envName: EnvOverrideVar,
  yamlValue: string,
  warn: (event: string, fields: Record<string, unknown>) => void,
  warned: Set<string>,
): string {
  const envVal = process.env[envName];
  if (envVal && envVal.length > 0) {
    if (!warned.has(envName)) {
      warned.add(envName);
      warn("config.env_override_used", { var: envName, value: envVal });
    }
    return envVal;
  }
  return yamlValue;
}

function parseProvidersFromTree(tree: unknown): ProviderConfig {
  const obj = (tree as { providers?: { defaultProfile?: string; profiles?: Record<string, Partial<ProviderProfile>> } } | undefined)?.providers;
  if (!obj) {
    return {
      profiles: {
        default: {
          name: "default",
          model: DEFAULTS.defaultModel,
          thinkingLevel: "medium",
        },
      },
      defaultProfile: DEFAULTS.defaultProfile,
    };
  }
  const profiles: Record<string, ProviderProfile> = {};
  for (const [name, p] of Object.entries(obj.profiles ?? {})) {
    if (!p || typeof p.model !== "string") continue;
    profiles[name] = { ...p, name } as ProviderProfile;
  }
  if (!profiles.default) {
    profiles.default = {
      name: "default",
      model: DEFAULTS.defaultModel,
      thinkingLevel: "medium",
    };
  }
  return { profiles, defaultProfile: obj.defaultProfile ?? DEFAULTS.defaultProfile };
}

function parsePluginSpec(raw: unknown): PluginSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginSpec[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push({ path: entry });
      continue;
    }
    if (entry && typeof entry === "object" && typeof (entry as PluginSpec).path === "string") {
      out.push({
        name: typeof (entry as PluginSpec).name === "string" ? (entry as PluginSpec).name : undefined,
        path: (entry as PluginSpec).path,
        config: (entry as PluginSpec).config,
      });
    }
  }
  return out;
}

function parseSchedules(raw: unknown): Schedule[] {
  if (!Array.isArray(raw)) return [];
  const out: Schedule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<Schedule>;
    if (typeof e.name !== "string" || typeof e.cron !== "string" || typeof e.hookName !== "string") {
      continue;
    }
    out.push({
      name: asScheduleName(e.name),
      cron: e.cron,
      hookName: e.hookName,
      payload: e.payload,
      enabled: e.enabled !== false,
      description: e.description,
    });
  }
  return out;
}