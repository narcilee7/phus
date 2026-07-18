// Top-level barrel for the pure-type layer. Re-exports the public
// domain types so consumers can import from a single path.
// Phase 1B will rewrite all imports to use the `@/` alias and point
// directly at this barrel where convenient.

export type { LogLevel, LogEvent } from "@/types/logger/index.js";

export type {
  Envelope,
  Outbound,
  EnvelopType,
  OutboundType,
} from "@/types/channel/index.js";

export type {
  HookName,
  HookMode,
  HookContext,
  HookImpl,
  RegisterOptions,
  TapeLike,
  SkillRegistryLike,
  TapeAnchorRef,
} from "@/types/hooks/index.js";

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
} from "@/types/tape/index.js";

export type {
  Schedule,
  FiredSchedule,
  SchedulerOptions,
} from "@/types/scheduler/index.js";

export type { SteeringInbox, SteeringEvent } from "@/types/steering/index.js";

export type {
  Plugin,
  PluginContext,
  LoadedPlugin,
  PluginLoaderOptions,
  HookBus,
  ChannelLike,
  InternalCommandLike,
} from "@/types/plugins/index.js";

export type { MetaTool } from "@/types/tool.js";

export type { Skill, SkillMetadata, SkillSource } from "@/types/skill.js";

export type { AuthorDefinition } from "@/types/enumTypes/index.js";