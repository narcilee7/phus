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
  ChannelConfig,
  EnvOverrideVar,
  LogConfig,
  MemoryConfig,
  MemoryMode,
  PathsConfig,
  PluginSpec,
  ResolvedConfig,
} from "./schema.js";
import { ENV_OVERRIDE_VARS } from "./schema.js";
import type { ProviderConfig, ProviderProfile, MeshSpec } from "@/infra/profile.js";
import type { Schedule } from "@/types/scheduler/index.js";
import { asScheduleName } from "@/types/brand.js";
import {
  looksLikeSecret,
  resolveAndCache,
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
    memoryFile: getPathField(interpolated, "memoryFile", DEFAULTS.memoryFile),
  };

  // Project memory autonomy config. Defaults to the safest mode (`propose`)
  // so existing users get an explicit-permission workflow without changes.
  const memory = parseMemoryConfig(interpolated, warn);

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
  const providers = parseProvidersFromTree(interpolated, warn);

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

  // Channels
  const channelsRaw = (interpolated as { channels?: unknown })?.channels;
  const channels: ChannelConfig[] = parseChannels(channelsRaw, warn);

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
    channels,
    schedules,
    memory,
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
    if (!profile.provider || !profile.modelId) {
      errors.push(
        `${cfgPath}: profile "${profileName}" is missing required provider or modelId ` +
        `(set both explicitly, or use the legacy model: "<provider>/<modelId>" form)`,
      );
      continue;
    }

    // Resolve via Pi registry (or synthesize for unknown gateways)
    const resolution = resolveAndCache({
      provider: profile.provider,
      modelId: profile.modelId,
      baseUrl: profile.baseUrl,
      overrideId: profile.wireId ?? profile.modelId,
    });
    if (!resolution.inRegistry) {
      const cacheKey = `${profile.provider}|${profile.modelId}`;
      if (!seen.has(cacheKey)) {
        seen.add(cacheKey);
        warn("config.model.not_in_registry", {
          provider: profile.provider,
          modelId: profile.modelId,
          profile: profileName,
          source: cfgPath,
          hint: profile.baseUrl
            ? "custom gateway endpoint — this is expected if baseUrl is an OpenAI-compatible gateway"
            : "no baseUrl set — verify the provider name and model id are correct",
        });
      }
    }

    // apiKeyEnv secret-in-yaml heuristic
    const secretHint = looksLikeSecret(profile.apiKeyEnv);
    if (secretHint) {
      warn("config.apiKeyEnv.looks_like_secret", {
        profile: profileName,
        apiKeyEnv: profile.apiKeyEnv,
        reason: secretHint,
        source: cfgPath,
      });
    }

    // Inline API keys work but are discouraged.
    if (profile.apiKey) {
      warn("config.apiKey.inline_used", {
        profile: profileName,
        hint: "apiKey is convenient but less secure than apiKeyEnv; consider moving the secret to an environment variable",
        source: cfgPath,
      });
    }

    // Validate each mesh entry
    if (profile.mesh) {
      for (let i = 0; i < profile.mesh.length; i++) {
        const entry = profile.mesh[i]!;
        if (!entry.provider || !entry.modelId) {
          errors.push(`${cfgPath}: mesh[${i}] of profile "${profileName}" is missing provider or modelId`);
          continue;
        }
        const meshResolution = resolveAndCache({
          provider: entry.provider,
          modelId: entry.modelId,
          baseUrl: entry.baseUrl,
          overrideId: entry.wireId ?? entry.modelId,
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
            hint: entry.baseUrl
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

/**
 * Parse `providers` from the interpolated YAML tree.
 *
 * Schema (current, single canonical form):
 *   providers:
 *     defaultProfile: <name>
 *     profiles:
 *       <name>:
 *         provider: <provider>           # required, Pi registry id
 *         modelId: <modelId>             # required, canonical Pi id
 *         wireId: <wire-id>             # optional, override for gateway wire id
 *         baseUrl: <url>                # optional
 *         apiKeyEnv: <ENV_VAR_NAME>      # optional
 *         mesh:
 *           - provider: <provider>       # required
 *             modelId: <modelId>         # required
 *             wireId: <wire-id>         # optional
 *             baseUrl: <url>            # optional
 *
 * Backward compatibility: legacy `model: "<provider>/<modelId>"` is
 * translated into `provider` + `modelId` when the explicit fields are
 * absent. Profiles missing required fields are skipped; the validator
 * surfaces a clear error for profiles that survive parsing.
 */
function parseProvidersFromTree(
  tree: unknown,
  warn: (event: string, fields: Record<string, unknown>) => void,
): ProviderConfig {
  const obj = (tree as {
    providers?: {
      defaultProfile?: string;
      profiles?: Record<string, Record<string, unknown> & { mesh?: unknown }>;
    };
  } | undefined)?.providers;

  if (!obj) {
    return {
      profiles: {
        default: {
          name: "default",
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
          thinkingLevel: "medium",
        },
      },
      defaultProfile: DEFAULTS.defaultProfile,
    };
  }

  const profiles: Record<string, ProviderProfile> = {};
  for (const [name, raw] of Object.entries(obj.profiles ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const profile = projectProfile(name, raw, warn);
    if (profile) profiles[name] = profile;
  }
  if (!profiles.default) {
    profiles.default = {
      name: "default",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      thinkingLevel: "medium",
    };
  }
  return { profiles, defaultProfile: obj.defaultProfile ?? DEFAULTS.defaultProfile };
}

/** Project one raw YAML profile object into a typed `ProviderProfile`. */
function projectProfile(
  name: string,
  raw: Record<string, unknown>,
  _warn: (event: string, fields: Record<string, unknown>) => void,
): ProviderProfile | null {
  const resolved = resolveModelFields(raw);
  if (!resolved) return null;

  const wireId = typeof raw.wireId === "string" && raw.wireId.length > 0 ? raw.wireId : undefined;

  const meshRaw = Array.isArray(raw.mesh) ? raw.mesh : undefined;
  const mesh = meshRaw
    ? meshRaw
        .map((entry, index) => projectMeshEntry(entry, { profileName: name, meshIndex: index }))
        .filter((m): m is MeshSpec => m !== null)
    : undefined;

  return {
    ...raw,
    name,
    provider: resolved.provider,
    modelId: resolved.modelId,
    wireId,
    ...(mesh ? { mesh } : {}),
  } as ProviderProfile;
}

function projectMeshEntry(
  raw: unknown,
  context: { profileName: string; meshIndex: number },
): MeshSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const resolved = resolveModelFields(r);
  if (!resolved) return null;
  const wireId = typeof r.wireId === "string" && r.wireId.length > 0 ? r.wireId : undefined;
  return { ...r, provider: resolved.provider, modelId: resolved.modelId, wireId } as MeshSpec;
}

/**
 * Resolve `provider` + `modelId` from explicit fields. No legacy
 * translation — both fields are required in the current schema.
 * Returns null when either is missing.
 */
function resolveModelFields(
  raw: Record<string, unknown>,
): { provider: string; modelId: string } | null {
  const provider =
    typeof raw.provider === "string" && raw.provider.length > 0 ? raw.provider : undefined;
  const modelId =
    typeof raw.modelId === "string" && raw.modelId.length > 0 ? raw.modelId : undefined;
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function parseMemoryConfig(
  interpolated: unknown,
  warn: (event: string, fields: Record<string, unknown>) => void,
): MemoryConfig {
  const raw = (interpolated as { memory?: unknown } | undefined)?.memory;
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const modeRaw = obj.mode;
  const validModes: readonly MemoryMode[] = ["propose", "approval-list", "yolo"];
  let mode: MemoryMode = "propose";
  if (typeof modeRaw === "string" && (validModes as readonly string[]).includes(modeRaw)) {
    mode = modeRaw as MemoryMode;
  } else if (modeRaw !== undefined) {
    warn("config.memory.invalid_mode", {
      value: String(modeRaw),
      valid: validModes,
      using: "propose",
    });
  }

  const autoApprove = Array.isArray(obj.autoApprove)
    ? obj.autoApprove.filter((x): x is string => typeof x === "string")
    : [];
  const requireApproval = Array.isArray(obj.requireApproval)
    ? obj.requireApproval.filter((x): x is string => typeof x === "string")
    : [];
  const logToTape = obj.logToTape !== false; // default true

  return { mode, autoApprove, requireApproval, logToTape };
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

function parseChannels(
  raw: unknown,
  warn: (event: string, fields: Record<string, unknown>) => void,
): ChannelConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: ChannelConfig[] = [];
  const validTypes = new Set<string>(["websocket", "sse", "telegram", "slack", "email", "whatsapp"]);
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type : "";
    if (!validTypes.has(type)) {
      warn("config.channel.invalid_type", { type, valid: Array.from(validTypes) });
      continue;
    }
    if (e.enabled === false) continue;
    out.push({ ...e, type: type as ChannelConfig["type"] });
  }
  return out;
}