/**
 * Hook definitions.
 *
 * Pure types — must not import any runtime module. Concrete runtime
 * services (Tape, SkillRegistry, HookRegistry, InternalCommand, ...) are
 * described here by narrow structural interfaces so consumers in
 * `core/*` and `bridge/*` can implement them without leaking their
 * concrete class identities back into the type layer.
 */

import type { Envelope } from "../../types/channel/index.js";
import type { TapeEntry, TapeAnchorRef } from "../../types/tape/index.js";
import type { Skill } from "../../types/skill.js";
import type { SessionId } from "../../types/brand.js";

// Re-export so consumers can `import { TapeAnchorRef } from ".../types/hooks"`
// without having to know it lives in types/tape.
export type { TapeAnchorRef };

/** Names of hooks supported by Phus. */
export type HookName =
  | "resolve_session"
  | "load_state"
  | "build_prompt"
  | "system_prompt"
  | "build_tape_context"
  | "before_llm_call"
  | "after_llm_call"
  | "before_tool_call"
  | "after_tool_call"
  | "render_outbound"
  | "dispatch_outbound"
  | "save_state"
  | "on_error"
  | "admit_message"
  | "provide_channels"
  | "register_cli_commands"
  | "provide_steering_inbox"
  | "plan_created"
  | "plan_step_started"
  | "plan_step_completed"
  | "plan_step_failed"
  | "plan_step_output"
  | "plan_step_retry"
  | "plan_subagent_started"
  | "plan_subagent_completed"
  | "plan_paused"
  | "plan_resumed"
  | "plan_cancelled"
  | "plan_completed";

export type HookMode = "first_result" | "chain" | "broadcast";

/**
 * Minimal Tape surface used by hook implementations. The concrete
 * `Tape` class in `core/tape.ts` implements this structurally.
 */
export interface TapeLike {
  append(entry: TapeEntry, meta?: Record<string, unknown>): void;
  replay(sessionId?: string): Generator<TapeEntry>;
  summary(sessionId: string, limit?: number): string;
  stats(): { totalEntries: number; sessions: Record<string, number> };
  loadAnchor(sessionId: string): TapeAnchorRef | undefined;
  pruneCheckpoints?(sessionId: string, keep?: number): number;
  close?(): void;
}

/**
 * Minimal SkillRegistry surface used by hook implementations. The
 * concrete `SkillRegistry` class in `core/skills/skill.ts` implements
 * this structurally.
 */
export interface SkillRegistryLike {
  discover(): Promise<void> | void;
  getAll(): readonly Skill[];
  get(name: string): Skill | undefined;
  toPromptContext(): string;
}

/** Context passed to every hook implementation. */
export interface HookContext {
  /** Optional because hooks fired outside a turn (e.g. by the
   *  scheduler) may not have a session in scope. */
  sessionId?: SessionId;
  state: Record<string, unknown>;
  /** Optional: not all hook chains have a tape in scope (e.g. scheduler fires). */
  tape?: TapeLike;
  /** Optional: not all hook chains have skills in scope. */
  skills?: SkillRegistryLike;
  /** Free-form extras (model output, tool call args, etc) — hook-specific. */
  extras: Record<string, unknown>;
  /** Inbound envelope, when the hook is triggered by a turn. */
  envelope?: Envelope;
}

export type HookImpl<T = unknown> = (
  ctx: HookContext,
) => Promise<T | undefined | null>;

export interface RegisterOptions {
  mode?: HookMode;
  priority?: number;
}