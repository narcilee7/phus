// src/tui/runtime/sync-output.ts
// Wrap a block of stdout writes in a CSI 2026 synchronized output frame so
// the terminal batches all bytes between BEGIN and END into a single atomic
// update. Without this, a multi-line TUI re-render paints the rows one at a
// time and the user sees a brief "tearing" pass — especially bad during
// IME composition on macOS where several intermediate strings arrive in
// quick succession.
//
// Terminals that don't support CSI 2026 (Windows Terminal pre-1.18, some
// embedded consoles) ignore the markers silently; we always emit them, so
// the wrapper is safe to apply unconditionally.
//
// CSI 2026 spec: https://gist.github.com/christianparpart/d8a62cc1ab59bf0e6c8d4e2e2e2c9b3e
//      BEGIN: \x1b[?2026h
//      END:   \x1b[?2026l

const BEGIN = "\x1b[?2026h";
const END = "\x1b[?2026l";

/** Run `fn` with synchronized output enabled. All writes performed by `fn`
 *  (directly or transitively through ink / stdout.write) are wrapped in
 *  CSI 2026 begin/end markers. */
export function withSyncOutput<T>(stdout: NodeJS.WriteStream, fn: () => T): T {
	stdout.write(BEGIN);
	try {
		return fn();
	} finally {
		stdout.write(END);
	}
}

/** Patch an existing NodeJS.WriteStream so every `write` call is wrapped
 *  in CSI 2026 automatically. Restore with the returned uninstall fn. */
export function installSyncOutput(stdout: NodeJS.WriteStream): () => void {
	const original = stdout.write.bind(stdout);
	const patched = (chunk: unknown, ...rest: unknown[]): boolean => {
		// Write BEGIN/END directly via `original` — calling `stdout.write`
		// here would recurse through `patched` (infinite loop) because we
		// have already replaced stdout.write.
		original(BEGIN);
		try {
			return original(chunk as never, ...(rest as []));
		} finally {
			original(END);
		}
	};
	stdout.write = patched as typeof stdout.write;
	return () => {
		stdout.write = original as typeof stdout.write;
	};
}
