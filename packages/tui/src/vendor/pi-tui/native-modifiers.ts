// src/tui/vendor/pi-tui/native-modifiers.ts
// Stub. The original pi-tui loaded darwin-modifiers.node (a native addon
// for accurate macOS modifier key state) via koffi; Phus vendors pi-tui
// without native deps, so this always returns `false`. Modifier state is
// still parsed from the kitty keyboard protocol when the terminal
// supports it (see keys.ts), so IME / shift detection still works for
// users on iTerm2 / WezTerm / kitty.

export type ModifierKey = "shift" | "command" | "control" | "option";

export function isNativeModifierPressed(_key: ModifierKey): boolean {
	return false;
}