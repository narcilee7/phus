/**
 * MetaTool — structural interface for LLM-callable meta-tools the agent
 * invokes to modify its own state (skill_write, skill_read, startup_write,
 * compact_session, etc.).
 *
 * Defined here in core so plugins and extensions can type-check against
 * it without depending on @phus/runtime. The concrete tool factories
 * (skill-tools, system-tools, plan-tools, etc.) live in
 * `@phus/runtime/infra/meta/*`.
 */
export interface MetaTool<TParams = unknown, TResult = unknown> {
	name: string;
	description: string;
	parameters: unknown;
	execute(params: TParams, context?: unknown): Promise<TResult> | TResult;
}