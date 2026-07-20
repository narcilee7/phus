// src/infra/config/index.ts
// Barrel re-export. External consumers should import from here.
//
// Internal modules import directly from each other (./loader.js,
// ./interpolate.js) to avoid circular deps at module-init time.

export { DEFAULTS, LOG_LEVELS, type LogLevelLiteral } from "./defaults.js";
export {
  interpolateEnv,
  extractVarRefs,
  ConfigError,
  VAR_NAME_REGEX,
  type InterpolateOptions,
} from "./interpolate.js";
export {
  loadConfig,
  resetConfigCache,
  configPath,
  resolvePhusHome,
  findMonorepoRoot,
  setLogSink,
  ConfigValidationError,
} from "./loader.js";
export {
  resolveAndCache,
  resetModelCache,
  validateModelString,
  validateMeshEntry,
  looksLikeSecret,
  type ModelResolution,
} from "./validate.js";
export type {
  ResolvedConfig,
  PathsConfig,
  LogConfig,
  PluginSpec,
  EnvOverrideVar,
} from "./schema.js";
export { ENV_OVERRIDE_VARS } from "./schema.js";