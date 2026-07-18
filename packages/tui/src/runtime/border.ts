// src/tui/runtime/border.ts
// Helpers to render a panel with a border around it. pi-tui's Box has
// no border support, so the existing React/ink Header / PlanPanel /
// PermissionPanel / DiffReview panels are reconstructed here.
//
// We render to a string[] of fixed height = content.length + 2 (top +
// bottom border rows). Width is computed from the longest content line.

import { colorize, padRight, visibleWidth } from "@/runtime/text-utils.js";

export type BorderStyle = "single" | "double" | "round" | "heavy";

interface BorderChars {
	tl: string;
	tr: string;
	bl: string;
	br: string;
	h: string;
	v: string;
}

const CHARS: Record<BorderStyle, BorderChars> = {
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
	round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
	heavy: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
};

/**
 * Render a bordered box. `lines` is the content (each line is one row).
 * Width is the full panel width including the two vertical borders and
 * the one-space padding on each side, so the inner content area is
 * `width - 4`. Lines longer than that are truncated.
 *
 *   box(["hello", "world"], "round", 20, "cyan")
 *
 * Returns lines of length exactly `height = lines.length + 2`. If you
 * want a fixed total height (e.g. for a row budget), pad/trim `lines`
 * before calling.
 */
export function box(
	lines: string[],
	style: BorderStyle,
	width: number,
	fg?: string,
): string[] {
	if (width < 4) return lines;
	const chars = CHARS[style];
	const innerWidth = width - 4; // 2 borders + 2 padding
	const border = fg ? (c: string) => colorize(c, fg) : (c: string) => c;
	const top = border(chars.tl) + border(chars.h.repeat(width - 2)) + border(chars.tr);
	const bottom = border(chars.bl) + border(chars.h.repeat(width - 2)) + border(chars.br);
	const middle = lines.map((line) => {
		const truncated = truncateToInner(line, innerWidth);
		const padded = padRight(" " + truncated + " ", width - 2);
		return border(chars.v) + padded + border(chars.v);
	});
	return [top, ...middle, bottom];
}

/**
 * Render a single-line horizontal divider. Useful between sections.
 */
export function divider(width: number, style: BorderStyle = "single", fg?: string): string {
	if (width < 1) return "";
	const chars = CHARS[style];
	const line = chars.h.repeat(width);
	return fg ? colorize(line, fg) : line;
}

function truncateToInner(s: string, innerWidth: number): string {
	if (innerWidth <= 0) return "";
	if (visibleWidth(s) <= innerWidth) return s;
	// Trim by visible width without breaking ANSI; use simple slice for now.
	let v = 0;
	let out = "";
	for (const ch of s) {
		const cw = visibleWidth(ch);
		if (v + cw > innerWidth - 1) break; // leave room for ellipsis
		out += ch;
		v += cw;
	}
	return out + "…";
}
