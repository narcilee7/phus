/**
 * Result<T, E> — discriminated union for fallible operations.
 *
 * Use instead of throwing when the caller is expected to handle the
 * failure (vs. the rare "this should never happen" throw). Pattern
 * matches to either ok or err without an extra `instanceof` check.
 *
 * ```ts
 * const r = await loadConfig(path);
 * if (r.ok) useConfig(r.value);
 * else log.error(r.error);
 * ```
 */
export type Result<T, E = Error> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Type guard narrowing. */
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/** Unwrap with a fallback. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
	r.ok ? r.value : fallback;

/** Map the success branch. */
export const mapResult = <T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> =>
	r.ok ? ok(f(r.value)) : r;

/** Map the error branch. */
export const mapErr = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
	r.ok ? r : err(f(r.error));