// src/tui/runtime/terminal-modes.ts
// Enable terminal-level features that improve TUI input handling:
//   - Bracketed paste mode (\x1b[?2004h): terminal wraps pasted content
//     in \x1b[200~ ... \x1b[201~ markers so we can distinguish a paste
//     of N characters from typing N characters. Without this we rely on
//     a timing heuristic (paste-burst.ts) which fails for fast typists.
//   - Application cursor keys (\x1b[?1h): arrow keys send ESC O A/B/C/D
//     instead of ESC [ A/B/C/D — fixes some terminal oddities.
//   - Alternate screen buffer (\x1b[?1049h): keeps the user's scrollback
//     intact while the TUI is running.
//
// On exit we send the corresponding disable sequences so the user's
// terminal returns to a sane state. Always restore on signal too — the
// caller is responsible for invoking `restoreTerminalModes()` on SIGINT.

const ENABLE = {
	bracketedPaste: "\x1b[?2004h",
	appCursorKeys: "\x1b[?1h",
	altScreen: "\x1b[?1049h",
} as const;

const DISABLE = {
	bracketedPaste: "\x1b[?2004l",
	appCursorKeys: "\x1b[?1l",
	altScreen: "\x1b[?1049l",
} as const;

export function enableTerminalModes(stdout: NodeJS.WriteStream): void {
	stdout.write(ENABLE.bracketedPaste);
	stdout.write(ENABLE.appCursorKeys);
	stdout.write(ENABLE.altScreen);
}

export function restoreTerminalModes(stdout: NodeJS.WriteStream): void {
	// Disable in reverse order so each mode is cleanly closed before the
	// next one restores the previous screen.
	stdout.write(DISABLE.bracketedPaste);
	stdout.write(DISABLE.appCursorKeys);
	stdout.write(DISABLE.altScreen);
}

/** Returns true if `data` is wrapped in a bracketed paste marker. */
export function isBracketedPasteStart(data: string): boolean {
	return data.startsWith("\x1b[200~");
}

export const BRACKETED_PASTE_END = "\x1b[201~";