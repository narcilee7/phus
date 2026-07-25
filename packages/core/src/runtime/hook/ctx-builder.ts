/**
 * Convenience builder for a base HookContext. `tape` and `skills` are
 * accepted as concrete types but stored as their narrow `TapeLike` /
 * `SkillRegistryLike` interfaces so a context built for a scheduler-fired
 * hook may legitimately omit them.
 */
import { Tape } from "../../session/tape.js";
import {
  HookContext,
  SessionContextLike,
  SkillRegistryLike,
  TapeLike,
} from "../../types/index.js";
import { asSessionId } from "../../types/brand.js";

export type CtxOptions = Partial<HookContext>
	& {
		tape?: Tape | TapeLike;
		skills?: SkillRegistryLike;
		/** String is accepted at I/O boundaries and cast on the fly. */
		sessionId?: string;
		/** Narrow resolved Session for the current turn. */
		session?: SessionContextLike;
	};

export const makeCtx = (partial: CtxOptions): HookContext => {
	return {
		envelope: partial.envelope,
		sessionId: partial.sessionId ? asSessionId(partial.sessionId) : undefined,
		session: partial.session,
		state: partial.state ?? {},
		tape: partial.tape,
		skills: partial.skills,
		extras: partial.extras ?? {},
	};
};