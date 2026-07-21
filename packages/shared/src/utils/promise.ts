/** Sleep for `ms` milliseconds. Returns a promise that resolves with
 *  no value. Cancelled timers are not aborted — the promise still
 *  resolves. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

/** Run `fn` with a timeout. Rejects with `Error(message)` after `ms`. */
export const withTimeout = async <T>(
	promise: Promise<T>,
	ms: number,
	message = `timed out after ${ms}ms`,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
};

/** Wait for all promises to settle (resolve or reject), then return
 *  their results / reasons as parallel arrays. */
export const settle = async <T>(
	promises: Promise<T>[],
): Promise<{ resolved: T[]; rejected: unknown[] }> => {
	const settled = await Promise.allSettled(promises);
	const resolved: T[] = [];
	const rejected: unknown[] = [];
	for (const s of settled) {
		if (s.status === "fulfilled") resolved.push(s.value);
		else rejected.push(s.reason);
	}
	return { resolved, rejected };
};