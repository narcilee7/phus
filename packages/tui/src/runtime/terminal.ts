// src/tui/runtime/terminal.ts
// Owns the terminal lifecycle for the TUI: composes pi-tui's
// ProcessTerminal (raw mode, bracketed paste, Kitty keyboard protocol,
// resize handler) with two extra responsibilities:
//
//   1. Alternate screen buffer so the user's scrollback is preserved
//      while the TUI runs (`\x1b[?1049h` / `\x1b[?1049l`).
//   2. Synchronized output wrapping via CSI 2026 around every write so
//      each render lands atomically (avoids mid-frame tearing on slow
//      terminals).
//
// Lifecycle note: pi-tui's `TUI.start()` calls `terminal.start()` on
// our behalf, and `TUI.stop()` calls `terminal.stop()`. We therefore
// must NOT call `terminal.start()` / `terminal.stop()` ourselves —
// only the alt-screen and sync-output toggles happen here, in the
// wrapper's start/stop.

import { ProcessTerminal, type Terminal } from "@/vendor/pi-tui/terminal.js";

export interface ManagedTerminalOptions {
	/** When false, skip the alt-screen toggle (useful for headless smoke). */
	altScreen?: boolean;
	/** When false, skip installing the CSI 2026 stdout monkey-patch. */
	syncOutput?: boolean;
}

export interface ManagedTerminal {
	readonly terminal: Terminal;
	/**
	 * Enable alt screen + CSI 2026 sync wrapping. Must be called
	 * BEFORE constructing the TUI (so the first sync wrap covers the
	 * TUI's first render).
	 */
	start(): void;
	/**
	 * Disable CSI 2026 wrapping + restore main screen. The underlying
	 * ProcessTerminal is stopped by `TUI.stop()` before this is called.
	 */
	stop(): void;
}

export function createManagedTerminal(opts: ManagedTerminalOptions = {}): ManagedTerminal {
	const altScreen = opts.altScreen ?? true;
	const syncOutput = opts.syncOutput ?? true;
	const terminal = new ProcessTerminal();
	let uninstallSync: (() => void) | undefined;

	return {
		terminal,
		start() {
			if (altScreen) {
				process.stdout.write("\x1b[?1049h");
			}
			if (syncOutput) {
				uninstallSync = installSyncOutput(process.stdout);
			}
		},
		stop() {
			if (uninstallSync) {
				uninstallSync();
				uninstallSync = undefined;
			}
			if (altScreen) {
				process.stdout.write("\x1b[?1049l");
			}
		},
	};
}

/**
 * Monkey-patch `stdout.write` so every chunk is wrapped in CSI 2026
 * (synchronized output). Returns an uninstall function.
 */
function installSyncOutput(stdout: NodeJS.WritableStream): () => void {
	const original = stdout.write.bind(stdout) as typeof stdout.write;
	const begin = "\x1b[?2026h";
	const end = "\x1b[?2026l";
	const wrapped = ((chunk: unknown, ...rest: unknown[]): boolean => {
		original(begin);
		// @ts-expect-error — variadic forwarding.
		const ok = original(chunk, ...rest);
		original(end);
		return ok;
	}) as typeof stdout.write;
	(stdout as unknown as { write: typeof stdout.write }).write = wrapped;
	return () => {
		(stdout as unknown as { write: typeof stdout.write }).write = original;
	};
}
