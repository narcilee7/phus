/**
 * AsyncResult<T, E> — Promise<Result<T, E>>.
 *
 * Convenience type for async operations that return a Result rather
 * than throwing. Use `awaitAsyncResult(p)` to unwrap.
 */
export type AsyncResult<T, E = Error> = Promise<import("./result.js").Result<T, E>>;

/** Await an AsyncResult and unwrap, throwing if it's an Err. */
export const awaitAsyncResult = async <T, E>(
	p: AsyncResult<T, E>,
): Promise<T> => {
	const r = await p;
	if (r.ok) return r.value;
	throw r.error instanceof Error ? r.error : new Error(String(r.error));
};