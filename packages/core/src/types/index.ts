// Top-level barrel for the pure-type layer. Re-exports the public
// domain types so consumers can import from a single path.
// Phase 1B will rewrite all imports to use the `@/` alias and point
// directly at this barrel where convenient.

export type { LogLevel, LogEvent } from "./logger/index.js";

export type {
  Envelope,
  Outbound,
  EnvelopType,
  OutboundType,
} from "./channel/index.js";

export type {
  HookName,
  HookMode,
  HookContext,
  HookImpl,
  RegisterOptions,
  TapeLike,
  SkillRegistryLike,
  SessionContextLike,
  TapeAnchorRef,
} from "./hooks/index.js";

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
} from "./tape/index.js";

export type {
  Schedule,
  FiredSchedule,
  SchedulerOptions,
} from "./scheduler/index.js";

export type { SteeringInbox, SteeringEvent } from "./steering/index.js";

export type {
  Plugin,
  PluginContext,
  LoadedPlugin,
  PluginLoaderOptions,
  HookBus,
  ChannelLike,
  InternalCommandLike,
} from "./plugins/index.js";

// export type { MetaTool } from "@phus/runtime/types/tool.js"; // re-enabled post Wave F (runtime dep)

export type { Skill, SkillMetadata, SkillSource } from "./skill.js";

export type { AuthorDefinition } from "./enumTypes/index.js";