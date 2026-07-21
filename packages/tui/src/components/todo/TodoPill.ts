// src/tui/components/todo/TodoPill.ts
// The single busy surface of the TUI ("RollingLine"): while a turn
// runs, an animated stone rolls up (and down) the hill next to either
// the running-tool pill or a rotating push verb. Idle → zero rows so
// the frame budget stays exact.

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { ChatItem } from "../../state/state.js";
import { colorize, padRight } from "../../runtime/text-utils.js";
import { ToolPill } from "../chat/ToolPill.js";
import type { SisyphusAnimator } from "../../runtime/sisyphus.js";

export class TodoPill implements Component {
	constructor(
		private readonly items: ChatItem[],
		private readonly busy: boolean,
		private readonly animator: SisyphusAnimator,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.busy) {
			const frame = colorize(this.animator.frame(), "cyan");
			const running = this.items.find(
				(it) => it.kind === "tool_call" && it.isError === undefined,
			);
			if (running) {
				const pill = new ToolPill(running.toolName ?? "tool", "running").render(width)[0] ?? "";
				return [padRight(`${frame} ${pill}`, width)];
			}
			return [
				padRight(
					`${frame} ${colorize(`${this.animator.verb()} the stone…`, "dim", "italic")}`,
					width,
				),
			];
		}
		// Idle → zero rows. Rendering a blank row here makes the frame one
		// row taller than the layout budget (which only counts the pill
		// while busy), and a constantly-overflowing frame corrupts the
		// differential repaint (header border scrolled off, stale rows).
		return [];
	}
}
