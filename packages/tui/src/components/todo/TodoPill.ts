// src/tui/components/todo/TodoPill.ts
// Single-row busy indicator. Shows running tool pills or the agent's
// last op caption.

import type { Component } from "@/vendor/pi-tui/tui.js";
import type { ChatItem } from "@/state/state.js";
import { colorize, padRight } from "@/runtime/text-utils.js";
import { ToolPill } from "@/components/chat/ToolPill.js";

export class TodoPill implements Component {
	constructor(
		private readonly items: ChatItem[],
		private readonly busy: boolean,
		private readonly lastOp: string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.busy) {
			const running = this.items.find(
				(it) => it.kind === "tool_call" && it.isError === undefined,
			);
			if (running) {
				return [padRight(new ToolPill(running.toolName ?? "tool", "running").render(width)[0] ?? "", width)];
			}
			return [padRight(colorize(`⠋ ${this.lastOp}`, "cyan"), width)];
		}
		// Idle → zero rows. Rendering a blank row here makes the frame one
		// row taller than the layout budget (which only counts the pill
		// while busy), and a constantly-overflowing frame corrupts the
		// differential repaint (header border scrolled off, stale rows).
		return [];
	}
}
