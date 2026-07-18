// src/tui/runtime/text-utils.ts
// Re-exports of vendored pi-tui text helpers, plus a small theme-aware
// `colorize` that maps the existing `ThemeColors` token names (e.g.
// "cyan", "redBright", "gray") onto standard ANSI SGR codes.
//
// Components consume these helpers instead of inlining `\x1b[…m` so the
// color palette stays greppable in one place.

import {
	visibleWidth as _visibleWidth,
	wrapTextWithAnsi as _wrapTextWithAnsi,
	truncateToWidth as _truncateToWidth,
	sliceByColumn as _sliceByColumn,
} from "@/vendor/pi-tui/utils.js";

export const visibleWidth = _visibleWidth;
export const wrapTextWithAnsi = _wrapTextWithAnsi;
export const truncateToWidth = _truncateToWidth;
export const sliceByColumn = _sliceByColumn;

const ANSI_RESET = "\x1b[0m";

// Theme color tokens (see theme/theme.ts) → ANSI foreground code.
// 30..37 standard, 90..97 bright. `gray` = bright black (90) to match
// what ink does when you pass the string "gray".
const FG: Record<string, number> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	gray: 90,
	blackBright: 90,
	redBright: 91,
	greenBright: 92,
	yellowBright: 93,
	blueBright: 94,
	magentaBright: 95,
	cyanBright: 96,
	whiteBright: 97,
};

const BG: Record<string, number> = {
	black: 40,
	red: 41,
	green: 42,
	yellow: 43,
	blue: 44,
	magenta: 45,
	cyan: 46,
	white: 47,
	gray: 100,
	blackBright: 100,
	redBright: 101,
	greenBright: 102,
	yellowBright: 103,
	blueBright: 104,
	magentaBright: 105,
	cyanBright: 106,
	whiteBright: 107,
};

const STYLE: Record<string, number> = {
	bold: 1,
	dim: 2,
	italic: 3,
	underline: 4,
	inverse: 7,
	strikethrough: 9,
};

/**
 * Wrap `text` with the given SGR code(s) and a trailing reset. Pass
 * either a theme color name (`"cyan"`, `"redBright"`) or an SGR modifier
 * key (`"bold"`, `"dim"`). Unknown keys are ignored.
 *
 *   colorize("hello", "cyan")        // \x1b[36mhello\x1b[0m
 *   colorize("warn", "yellow", true) // \x1b[1;33mwarn\x1b[0m
 */
export function colorize(text: string, ...tokens: (string | boolean)[]): string {
	const codes: number[] = [];
	let bg = 0;
	for (const tok of tokens) {
		if (typeof tok !== "string") continue;
		const fg = FG[tok];
		if (fg !== undefined) {
			codes.push(fg);
			continue;
		}
		const bgCode = BG[tok];
		if (bgCode !== undefined) {
			bg = bgCode;
			continue;
		}
		const mod = STYLE[tok];
		if (mod !== undefined) {
			codes.push(mod);
			continue;
		}
		// Unknown token — silently drop. This lets theme.ts iterate a
		// color key without each call site having to check membership.
	}
	if (codes.length === 0 && bg === 0) return text;
	const all = [...codes, bg].filter((c) => c > 0);
	return `\x1b[${all.join(";")}m${text}${ANSI_RESET}`;
}

/**
 * Apply a function that produces an ANSI-styled line. Convenience for
 * the common pattern `lines.map(line => colorize(line, color))`.
 */
export function colorEach(lines: string[], ...tokens: (string | boolean)[]): string[] {
	return lines.map((line) => colorize(line, ...tokens));
}

/**
 * Pad `s` on the right with spaces so its visible width is exactly
 * `width`. Honors existing ANSI escapes (doesn't count them).
 */
export function padRight(s: string, width: number): string {
	const v = visibleWidth(s);
	if (v >= width) return s;
	return s + " ".repeat(width - v);
}

/**
 * Center `s` within `width`, padding both sides. Honors ANSI width.
 */
export function center(s: string, width: number): string {
	const v = visibleWidth(s);
	if (v >= width) return s;
	const total = width - v;
	const left = Math.floor(total / 2);
	const right = total - left;
	return " ".repeat(left) + s + " ".repeat(right);
}
