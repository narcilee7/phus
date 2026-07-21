/**
 * Hook registry with three execution modes:
 *   - first_result: return the first non-null implementation result
 *   - chain:       pipe ctx through each implementation in priority order
 *   - broadcast:   invoke every implementation in parallel, return all results
 *
 * Optional `onError` callback fires for isolated failures. Default is a no-op;
 * runtime injects its logger wrapper to preserve observability.
 */

import { Tape } from "../../session/tape.js";
import { HookContext, HookImpl, HookMode, HookName, RegisterOptions, TapeLike } from "../../types/index.js";
import { asSessionId } from "../../types/brand.js";

interface RegisteredHook {
	impl: HookImpl<any>;
	priority: number;
}

export interface HookRegistryOptions {
	isolateErrors?: boolean;
	/** Called for isolated failures when `isolateErrors: true`. */
	onError?: (event: string, fields?: Record<string, unknown>) => void;
}

export class HookRegistry {
	private hooks = new Map<HookName, Array<RegisteredHook>>();
	private modes = new Map<HookName, HookMode>();
	private isolateErrors = false;
	private readonly onError: (event: string, fields?: Record<string, unknown>) => void;

	constructor(opts: HookRegistryOptions = {}) {
		this.isolateErrors = opts.isolateErrors ?? false;
		this.onError = opts.onError ?? (() => {});
	}

	/** Register an implementation for a hook. Default mode is `chain`. */
	register<T>(name: HookName, impl: HookImpl<T>, opts: RegisterOptions = {}): void {
		const { mode = "chain", priority = 0 } = opts;
		const arr = this.hooks.get(name) ?? [];
		arr.push({ impl, priority });
		// Higher priority first; stable for equal priority.
		arr.sort((a, b) => b.priority - a.priority);
		this.hooks.set(name, arr);
		// First registration sets the default mode; later registrations don't override.
		if (!this.modes.has(name)) this.modes.set(name, mode);
	}

	/** Execute all implementations of a hook according to its registered mode.
	 *
	 *  With `isolateErrors: true`, a single hook throwing does NOT abort the
	 *  chain — the error is reported via `onError` and the previous result
	 *  is used. Without isolation, the first throw propagates (Bub default). */
	async execute<T>(name: HookName, ctx: HookContext, mode?: HookMode): Promise<T> {
		const chain = this.hooks.get(name) ?? [];
		const effective = mode ?? this.modes.get(name) ?? "chain";

		if (effective === "first_result") {
			for (const { impl } of chain) {
				try {
					const r = await impl(ctx);
					if (r !== undefined && r !== null) return r as T;
				} catch (err) {
					this.handleHookError(name, err, ctx);
				}
			}
			return undefined as T;
		}

		if (effective === "chain") {
			let current: HookContext = ctx;
			for (const { impl } of chain) {
				try {
					current = (await impl(current)) ?? current;
				} catch (err) {
					this.handleHookError(name, err, ctx);
				}
			}
			return current as T;
		}

		// broadcast
		const results = await Promise.all(
			chain.map(async ({ impl }) => {
				try {
					return await impl(ctx);
				} catch (err) {
					this.handleHookError(name, err, ctx);
					return undefined;
				}
			}),
		);
		return results.filter((r) => r !== undefined && r !== null) as T;
	}

	private handleHookError(name: HookName, err: unknown, ctx: HookContext): void {
		if (this.isolateErrors) {
			this.onError("hook.failed_isolated", {
				hook: name,
				sessionId: ctx.sessionId,
				error: (err as Error).message ?? String(err),
			});
		} else {
			throw err;
		}
	}

	/** Inspect registered implementations (used by `phus hooks` diagnostic command). */
	report(): Record<string, Array<{ priority: number; mode: HookMode }>> {
		const out: Record<string, Array<{ priority: number; mode: HookMode }>> = {};
		for (const [name, impls] of this.hooks) {
			out[name] = impls.map(({ priority }) => ({
				priority,
				mode: this.modes.get(name) ?? "chain",
			}));
		}
		return out;
	}
}