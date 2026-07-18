// src/tui/components/chat/ChatViewport.ts
// Bottom-anchored scrollable viewport for chat history. Reads
// `items`, `busy`, `scrollOffset`, `hasNew`, `lastOp`, `fileSnapshots`
// from props (driven by the store). Renders each item via ChatItemView.
//
// M2 surface: read-only. M3 wires keyboard scrolling (PgUp/PgDn/arrows).

import type { Component } from "@/vendor/pi-tui/tui.js";
import type { ChatItem, AppState } from "@/state/state.js";
import { ChatItemView } from "@/components/chat/ChatItemView.js";
import type { FileSnapshot } from "@/components/chat/ToolResultCard.js";
import { bottomAnchoredSlice } from "@/runtime/scroll.js";
import { colorize, padRight, sliceByColumn, visibleWidth } from "@/runtime/text-utils.js";

export interface ChatViewportDeps {
	readonly items: ChatItem[];
	readonly busy: boolean;
	readonly scrollOffset: number;
	readonly hasNew: boolean;
	readonly lastOp: string;
	readonly fileSnapshots: Map<string, FileSnapshot>;
}

export class ChatViewport implements Component {
	private height = 6;
	private depsInternal: ChatViewportDeps;
	constructor(deps: ChatViewportDeps) {
		this.depsInternal = deps;
	}

	get deps(): ChatViewportDeps {
		return this.depsInternal;
	}

	setHeight(h: number): void {
		this.height = h;
	}

	setDeps(deps: ChatViewportDeps): void {
		this.depsInternal = deps;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const { items, scrollOffset, hasNew, busy, lastOp } = this.deps;
		if (items.length === 0) {
			return this.emptyState(width, busy, lastOp);
		}

		// Render each item; remember rendered heights.
		const rendered: { rows: string[]; item: ChatItem }[] = [];
		const heights: number[] = [];
		for (const item of items) {
			const snap = this.lookupSnapshot(item);
			const view = new ChatItemView(item, snap);
			const rows = view.render(width);
			rendered.push({ rows, item });
			heights.push(rows.length);
		}

		const { startIndex, skipRows } = bottomAnchoredSlice(items, heights, this.height, scrollOffset);

		// Flatten the window's items, drop the partial rows above the
		// window's top edge, then take exactly `height` rows.
		const out: string[] = [];
		let skipping = skipRows;
		for (const { rows } of rendered.slice(startIndex)) {
			for (const line of rows) {
				if (skipping > 0) {
					skipping--;
					continue;
				}
				out.push(padRight(line, width));
				if (out.length >= this.height) break;
			}
			if (out.length >= this.height) break;
		}

		// Fill remaining rows; the last row shows a busy spinner.
		while (out.length < this.height) {
			if (busy && out.length === this.height - 1) {
				out.push(padRight(colorize(`⠋ ${lastOp}`, "cyan"), width));
			} else {
				out.push(padRight("", width));
			}
		}

		// "New messages" pill if scrolled up.
		if (hasNew && scrollOffset > 0) {
			const pill = colorize(" ↓ new messages ", "inverse");
			const lastIdx = this.height - 1;
			out[lastIdx] = sliceByColumn(centerText(pill, width), 0, width);
		}

		return out.slice(0, this.height);
	}

	private emptyState(width: number, busy: boolean, lastOp: string): string[] {
		const out: string[] = [];
		const pad = Math.max(0, Math.floor((this.height - 2) / 2));
		for (let i = 0; i < pad; i++) out.push(padRight("", width));
		out.push(padRight(centerText(colorize("· type to start ·", "dim"), width), width));
		if (busy) out.push(padRight(centerText(colorize(`⠋ ${lastOp}`, "cyan"), width), width));
		else out.push(padRight(centerText(colorize("Push the stone up the mountain.", "dim"), width), width));
		while (out.length < this.height) out.push(padRight("", width));
		return out;
	}

	private lookupSnapshot(item: ChatItem): FileSnapshot | undefined {
		if (item.kind !== "tool_call" && item.kind !== "tool_result") return undefined;
		if (item.toolName !== "file_write") return undefined;
		if (!item.toolCallId) return undefined;
		return this.deps.fileSnapshots.get(item.toolCallId);
	}
}

function centerText(s: string, width: number): string {
	// visibleWidth ignores ANSI escapes; string length would count them
	// and shove the pill off-center (or off-screen for inverse labels).
	const visible = visibleWidth(s);
	const v = Math.max(0, Math.floor((width - visible) / 2));
	return " ".repeat(v) + s;
}

// Allow direct import as `AppState`-aware — for tests / type cohesion.
export type { AppState };
