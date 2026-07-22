// src/infra/config/schema.ts
// Public types for the unified config loader.
//
// The shape mirrors the YAML layout (paths, log, providers, plugins,
// schedules) so the file IS the API. Adding a new top-level YAML
// section means adding it here + in loader.ts.

import type { ProviderConfig } from "../profile.js";
import type { Schedule } from "@phus/core/types/scheduler/index.js";
import type { LogLevelLiteral } from "./defaults.js";
import { RobustnessConfig } from "../llm-fuse.js";

/** Resolved filesystem paths. */
export interface PathsConfig {
  home: string;
  tapeDb: string;
  skillsDir: string;
  /** Project memory file (phus.md). The agent reads & writes this across sessions. */
  memoryFile: string;
}

/**
 * Autonomy mode for `memory_write` tool calls.
 *
 * - `propose` (default): every write requires explicit user approval via the
 *   TUI PermissionBar.
 * - `approval-list`: writes matching `autoApprove` go straight through;
 *   everything else needs approval. `requireApproval` is a hard deny-list
 *   that overrides `autoApprove`.
 * - `yolo`: writes always go through, only audit logged.
 */
export type MemoryMode = "propose" | "approval-list" | "yolo";

/**
 * Parsed `memory:` section of phus.config.yaml. Consumed by
 * `AutonomyGate.fromConfig` to decide per-call whether to prompt.
 */
export interface MemoryConfig {
  mode: MemoryMode;
  autoApprove: string[];
  requireApproval: string[];
  logToTape: boolean;
}

/**
 * Reflection config — the post-turn `TurnReflector` consults these
 * fields. Off by default. Operators opt in via:
 *
 *   memory:
 *     autoReflect: true
 *     reflectMinTurnLength: 240
 *     reflectMaxPerTurn: 2
 */
export interface ReflectConfig {
  autoReflect: boolean;
  reflectMinTurnLength: number;
  reflectMaxPerTurn: number;
}

/** Resolved logger config. */
export interface LogConfig {
  file: string;
  level: LogLevelLiteral;
}

/**
 * Resolved safety policy config. Mirrors the `safety:` section of
 * phus.config.yaml. Currently only the `file_write` allowlist is
 * exposed — bash blocklist patterns stay hardcoded in
 * `infra/safety.ts` because tightening/loosening them is a security
 * primitive that should go through code review.
 *
 * `fileWriteRoots` is a list of paths (absolute or cwd-relative). When
 * the agent calls `file_write`, the absolute target must resolve under
 * one of these roots or the call is rejected by `before_tool_call`
 * before it ever reaches the user-facing permission gate. Default =
 * `["./"]` (the workspace root) so a typical session can edit files
 * locally; tighten to `./skills,./.phus,./tmp` etc. for stricter
 * deployments.
 */
export interface SafetyConfig {
  fileWriteRoots: string[];
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
 * Channel entry as it appears in `phus.config.yaml::channels`.
 * The `type` field selects the built-in channel implementation;
 * remaining fields are passed through to the channel constructor.
 */
export interface ChannelConfig {
  type: "websocket" | "sse" | "telegram" | "slack" | "email" | "whatsapp";
  enabled?: boolean;
  port?: number;
  host?: string;
  path?: string;
  token?: string;
  botToken?: string;
  appToken?: string;
  user?: string;
  password?: string;
  imapPort?: number;
  tls?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  pollIntervalSeconds?: number;
  mailbox?: string;
  allowedUsers?: string[] | string;
  allowedChats?: string[] | string;
  [key: string]: unknown;
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
  channels: ChannelConfig[];
  schedules: Schedule[];
  /** Project memory autonomy + storage config. */
  memory: MemoryConfig;
  /** Auto-reflection knobs (per-turn `memory_write` proposals). */
  reflect: ReflectConfig;
  /** Safety policy knobs the operator can tighten/loosen at runtime. */
  safety: SafetyConfig;
  /** LLM runaway guards: timeouts, call budgets, billing fuse. */
  robustness: RobustnessConfig;
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
