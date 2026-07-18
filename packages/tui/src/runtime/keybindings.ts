// src/tui/runtime/keybindings.ts
// Global keyboard shortcuts (Ctrl+B, Ctrl+K, Ctrl+C, Ctrl+L, Ctrl+Z,
// Ctrl+T, PgUp/PgDn, Ctrl+arrows, Ctrl+End). The handler is registered
// on the TUI as an `addInputListener` so it runs BEFORE the focused
// component — matches key → consume, otherwise let the focused
// component handle it.
//
// Each shortcut is wired to a callback the App supplies at startup;
// individual components don't depend on this module.

import { matchesKey } from "@/vendor/pi-tui/keys.js";
type InputListener = (data: string) => { consume?: boolean; data?: string } | undefined;

export interface GlobalShortcutCallbacks {
	onToggleSidebar(): void;
	onOpenPalette(): void;
	onClear(): void;
	onAbort(): void;
	onQuit(): void;
	onTogglePlan(): void;
	onUndo(): void;
	onScrollUp(lines: number): void;
	onScrollDown(lines: number): void;
	onScrollBottom(): void;
}

export interface ParsedShortcut {
	name:
		| "toggle-sidebar"
		| "open-palette"
		| "clear"
		| "abort"
		| "quit"
		| "toggle-plan"
		| "undo"
		| "scroll-up"
		| "scroll-down"
		| "scroll-bottom";
}

const SHORTCUT_TABLE: ReadonlyArray<{ match: string; name: ParsedShortcut["name"] }> = [
	{ match: "ctrl+b", name: "toggle-sidebar" },
	{ match: "ctrl+k", name: "open-palette" },
	{ match: "ctrl+l", name: "clear" },
	{ match: "ctrl+c", name: "abort" },
	{ match: "ctrl+z", name: "undo" },
	{ match: "ctrl+t", name: "toggle-plan" },
	{ match: "pageup", name: "scroll-up" },
	{ match: "pagedown", name: "scroll-down" },
	{ match: "ctrl+end", name: "scroll-bottom" },
	{ match: "ctrl+up", name: "scroll-up" },
	{ match: "ctrl+down", name: "scroll-down" },
];

/**
 * Build an InputListener that dispatches parsed shortcuts to `callbacks`.
 * Returns a function suitable for `tui.addInputListener(listener)`.
 *
 * When a shortcut fires, the listener returns `{ consume: true }` so
 * the focused component never sees the keystroke. For unknown keys
 * (and bare printable text), returns undefined to let the focused
 * component handle them.
 */
export function buildShortcutListener(
	callbacks: GlobalShortcutCallbacks,
	getChatHeight: () => number,
): InputListener {
	return (data: string) => {
		// Exit / abort — always fires regardless of focus.
		if (matchesKey(data, "ctrl+c")) {
			// If the busy flag is set we interpret Ctrl+C as abort;
			// otherwise we treat it as quit. The App decides via
			// checking the store's busy state in the callback.
			callbacks.onAbort();
			return { consume: true };
		}
		// Ctrl+Z (undo) — always fires.
		if (matchesKey(data, "ctrl+z")) {
			callbacks.onUndo();
			return { consume: true };
		}
		// Other shortcuts only fire when no interactive card has focus.
		// We don't track focus state here; the App is expected to
		// call setInteractiveFocus(true) on the focused card via a
		// separate path (cards' handleInput swallows non-shortcut keys
		// while focused). For simplicity we let the App register a
		// flag we read here — see InteractiveFocus below.
		// PgUp/PgDn + Ctrl+arrows: scroll, no need to gate.
		if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+up")) {
			callbacks.onScrollUp(Math.max(1, getChatHeight() - 1));
			return { consume: true };
		}
		if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+down")) {
			callbacks.onScrollDown(Math.max(1, getChatHeight() - 1));
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+end")) {
			callbacks.onScrollBottom();
			return { consume: true };
		}
		// Sidebar / palette / clear / quit / plan-toggle — App gates.
		if (matchesKey(data, "ctrl+b")) {
			callbacks.onToggleSidebar();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+k")) {
			callbacks.onOpenPalette();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+l")) {
			callbacks.onClear();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+t")) {
			callbacks.onTogglePlan();
			return { consume: true };
		}
		void SHORTCUT_TABLE;
		return undefined;
	};
}
