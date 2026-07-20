// packages/core/src/index.ts
// Public façade of @phus/core. Today this is a curated re-export of
// types and constants from @phus/runtime so consumers can depend on
// @phus/core without taking a dep on the bridge / channels / Pi
// integration. The Stage-1 follow-up migrates the actual source files
// from packages/runtime/src/{core,types,utils,infra/*} into
// packages/core/src/ so the boundary is owned, not proxied.
//
// What is intentionally NOT here:
//   - PhusAgent (Pi-aware) — @phus/runtime
//   - Channels, meta-tools, mesh — @phus/runtime
//   - Anything that touches Pi / LLM APIs

// Constants / value exports used by config + log levels.
export { DEFAULTS, LOG_LEVELS, type LogLevelLiteral } from "@phus/runtime/infra/config/index.js";

// Types — re-exported from runtime's existing barrels so plugins /
// extensions can `import type { HookName, Envelope, TapeEntry } from
// "@phus/core"` without depending on the bridge / channels.
export type {
	LogLevel,
	LogEvent,
} from "@phus/runtime/infra/logging.js";

export type {
	Envelope,
	Outbound,
	EnvelopType,
	OutboundType,
} from "@phus/runtime/types/channel/index.js";

export type {
	HookName,
	HookMode,
	HookContext,
	HookImpl,
	RegisterOptions,
	TapeLike,
	SkillRegistryLike,
	TapeAnchorRef,
} from "@phus/runtime/types/hooks/index.js";

export type {
	TapeEntry,
	TapeEntryKind,
	TapeTurnEntry,
	TapeAnchorEntry,
	TapeToolCallEntry,
	TapeToolResultEntry,
	TapeErrorEntry,
	TapeCheckpointEntry,
	TapeState,
	Turn,
	TapeToolCall,
} from "@phus/runtime/types/tape/index.js";

export type {
	Schedule,
	FiredSchedule,
	SchedulerOptions,
} from "@phus/runtime/types/scheduler/index.js";

export type { SteeringInbox, SteeringEvent } from "@phus/runtime/types/steering/index.js";

export type {
	Plugin,
	PluginContext,
	LoadedPlugin,
	PluginLoaderOptions,
	HookBus,
	ChannelLike,
	InternalCommandLike,
} from "@phus/runtime/types/plugins/index.js";

export type { MetaTool } from "@phus/runtime/types/tool.js";
export type { Skill, SkillMetadata, SkillSource } from "@phus/runtime/types/skill.js";
export type { AuthorDefinition } from "@phus/runtime/types/enumTypes/index.js";
export type { ResolvedConfig, PathsConfig, LogConfig, PluginSpec, EnvOverrideVar } from "@phus/runtime/infra/config/index.js";
