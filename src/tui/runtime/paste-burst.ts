// src/tui/runtime/paste-burst.ts
// Detect rapid-fire character arrivals that signal a non-bracketed paste,
// so an Enter arriving shortly after the burst inserts a newline instead of
// submitting the draft.
//
// Ported from @moonshot-ai/pi-tui (MIT, Copyright (c) 2025 Moonshot AI).
// This is a heuristic fallback for terminals that don't surface bracketed
// paste markers (we enable bracketed paste separately when supported —
// see src/tui/runtime/terminal-modes.ts). The class does NOT buffer
// characters; the editor still inserts typed text normally. It only
// decides whether an imminent Enter should be treated as a newline.

const PASTE_BURST_MIN_CHARS = 8;
const PASTE_BURST_CHAR_INTERVAL_MS = 8;
const PASTE_BURST_ACTIVE_IDLE_TIMEOUT_MS = 30;
const PASTE_ENTER_SUPPRESS_WINDOW_MS = 120;

export class PasteBurst {
	private lastPlainCharAt: number | undefined;
	private consecutivePlainChars = 0;
	private activeUntil = 0;
	private enterSuppressUntil = 0;

	/** Call for every plain printable character the editor inserts. */
	onPlainChar(now: number): void {
		if (
			this.lastPlainCharAt !== undefined &&
			now - this.lastPlainCharAt <= PASTE_BURST_CHAR_INTERVAL_MS
		) {
			this.consecutivePlainChars++;
		} else {
			this.consecutivePlainChars = 1;
		}

		this.lastPlainCharAt = now;

		if (this.consecutivePlainChars >= PASTE_BURST_MIN_CHARS) {
			this.extendWindow(now);
		}
	}

	/** Returns true if Enter arriving at `now` should insert a newline
	 *  instead of submitting. */
	shouldInsertNewlineInsteadOfSubmit(now: number): boolean {
		if (now <= this.activeUntil || now <= this.enterSuppressUntil) {
			return true;
		}

		return (
			this.lastPlainCharAt !== undefined &&
			this.consecutivePlainChars >= PASTE_BURST_MIN_CHARS &&
			now - this.lastPlainCharAt <= PASTE_BURST_CHAR_INTERVAL_MS
		);
	}

	extendWindow(now: number): void {
		this.activeUntil = now + PASTE_BURST_ACTIVE_IDLE_TIMEOUT_MS;
		this.enterSuppressUntil = now + PASTE_ENTER_SUPPRESS_WINDOW_MS;
	}

	reset(): void {
		this.lastPlainCharAt = undefined;
		this.consecutivePlainChars = 0;
		this.activeUntil = 0;
		this.enterSuppressUntil = 0;
	}
}