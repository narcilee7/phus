
/**
 * Convenience builder for a base HookContext. `tape` and `skills` are
 * accepted as concrete types but stored as their narrow `TapeLike` /
 * `SkillRegistryLike` interfaces so a context built for a scheduler-fired
 * hook may legitimately omit them.
 */
import { Tape } from "../session/tape.js";
import { SkillRegistry } from "@phus/runtime/infra/skills/registry.js";
import { HookContext, SkillRegistryLike, TapeLike } from "../types/index.js"
import { asSessionId } from "../types/brand.js";

export type CtxOptions = Partial<HookContext>
  & {
    tape?: Tape | TapeLike;
    skills?: SkillRegistry | SkillRegistryLike;
    /** String is accepted at I/O boundaries and cast on the fly. */
    sessionId?: string;
}

export const makeCtx = (partial: CtxOptions) => {
  return {
    envelope: partial.envelope,
    sessionId: partial.sessionId ? asSessionId(partial.sessionId) : undefined,
    state: partial.state ?? {},
    tape: partial.tape,
    skills: partial.skills,
    extras: partial.extras ?? {},
  };
}
