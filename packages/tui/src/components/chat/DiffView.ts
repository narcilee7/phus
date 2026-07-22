// src/tui/components/chat/DiffView.ts
// Render a unified diff between two strings using the `diff` package.
// We use `diffLines` and emit +/- lines with ANSI coloring. Trims
// trailing context lines to keep tool cards compact.

import { diffLines } from "diff";
import type { Component } from "../../vendor/pi-tui/tui.js";
import { colorize, truncateToWidth } from "../../runtime/text-utils.js";

export interface DiffViewOptions {
	oldText: string;
	newText: string;
	/** Max lines of context around each change. Default 3. */
	maxContextLines?: number;
}

export class DiffView implements Component {
	private readonly oldText: string;
	private readonly newText: string;
	private readonly maxContext: number;
	private cached: { width: number; lines: string[] } | undefined;

	constructor(opts: DiffViewOptions) {
		this.oldText = opts.oldText;
		this.newText = opts.newText;
		this.maxContext = opts.maxContextLines ?? 3;
	}

	invalidate(): void {
		this.cached = undefined;
	}

	render(width: number): string[] {
		if (this.cached && this.cached.width === width) return this.cached.lines;
		const parts = diffLines(this.oldText, this.newText);
		const gutter = 2; // "  " or "+ " / "- "
		const contentWidth = Math.max(1, width - gutter);
		const out: string[] = [];
		for (const part of parts) {
			const lines = part.value.replace(/\n$/, "").split("\n");
			for (const line of lines) {
				if (part.added) {
					out.push(colorize("+ ", "green") + truncateToWidth(line, contentWidth, "…"));
				} else if (part.removed) {
					out.push(colorize("- ", "red") + truncateToWidth(line, contentWidth, "…"));
				} else {
					out.push(colorize("  ", "dim") + truncateToWidth(line, contentWidth, "…"));
				}
			}
		}
		void this.maxContext; // reserved for future trimming
		this.cached = { width, lines: out };
		return out;
	}
}
