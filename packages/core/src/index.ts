// packages/core/src/index.ts
// Public façade of @phus/core. Hand-curated re-export of every type,
// constant, and helper that lives in `packages/core/src/`. Plugins and
// extensions can `import { ... } from "@phus/core"` without depending
// on the bridge / channels / LLM runner (which stay in @phus/runtime).
//
// What is intentionally NOT here:
//   - PhusAgent (Pi-aware) — @phus/runtime
//   - Channels, meta-tools, mesh — @phus/runtime
//   - Anything that touches Pi / LLM APIs

// ── Channel types
export type { Envelope, Outbound, EnvelopType, OutboundType } from "./types/channel/index.js";

// ── Hook types
export type {
	HookName,
	HookMode,
	HookContext,
	HookImpl,
	RegisterOptions,
	TapeLike,
	SkillRegistryLike,
	TapeAnchorRef,
} from "./types/hooks/index.js";

// ── Tape types (entries that survive d.ts propagation)
export type {
	TapeEntry,
	TapeEntryKind,
	TapeTurnEntry,
	TapeAnchorEntry,
} from "./types/tape/index.js";

// ── Session types
export type {
	Session,
	SessionAddress,
	SessionOrigin,
	SessionKind,
	SessionStatus,
	CreateSessionOptions,
	SessionFilter,
} from "./types/session/index.js";

// ── Session temporal store
export { SessionTape } from "./session/session-tape.js";
export type {
	SessionTapeOptions,
	SessionCompactionOptions,
	SessionAutoCompactArgs,
} from "./session/session-tape.js";

// ── Session identity catalog
export { SessionIdentityStore, IdentityMergeConflictError } from "./session/session-identity.js";
export type { SessionIdentity, IdentitySubject } from "./session/session-identity.js";

// ── Scheduler types
export type { Schedule, FiredSchedule, SchedulerOptions } from "./types/scheduler/index.js";

// ── Steering types
export type { SteeringInbox, SteeringEvent } from "./types/steering/index.js";

// ── Plugin types
export type {
	Plugin,
	PluginContext,
	LoadedPlugin,
	PluginLoaderOptions,
	HookBus,
	ChannelLike,
	InternalCommandLike,
} from "./types/plugins/index.js";

// ── Skill / Author types
export type { Skill, SkillMetadata, SkillSource } from "./types/skill.js";
export type { AuthorDefinition } from "./types/enumTypes/index.js";

// ── Brand types
export type { SessionId } from "./types/brand.js";

// ── MetaTool — structural interface owned by core so plugins/extensions
//    can type-check against it without depending on @phus/runtime.
export type { MetaTool } from "./types/tool.js";
