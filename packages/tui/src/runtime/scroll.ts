// src/tui/runtime/scroll.ts
// Helpers for bottom-anchored chat scroll math.

import type { ChatItem } from "@/state/state.js";

export interface ScrollPosition {
	/** Index into the rendered item list that the top row corresponds to. */
	startIndex: number;
	/** Total number of rows the rendered item list would occupy if the
	 *  viewport were tall enough. Used for "↑ N more" indicators. */
	totalRows: number;
}

/**
 * Compute which items fit into a viewport of `height` rows, anchored to
 * the bottom, given a scroll offset (lines from the bottom).
 *
 *   const { startIndex, totalRows } = bottomAnchoredSlice(items, itemHeights, height, offset);
 *
 * `itemHeights[i]` is the rendered height (rows) of item `i`. Returns
 * `{ startIndex, totalRows }` so the caller can render `items.slice(startIndex)`
 * and report "scroll position X / totalRows" in the UI.
 */
export function bottomAnchoredSlice(
	items: ChatItem[],
	itemHeights: number[],
	height: number,
	offset: number,
): ScrollPosition {
	const total = itemHeights.reduce((a, h) => a + h, 0);
	if (height <= 0 || items.length === 0) {
		return { startIndex: 0, totalRows: total };
	}
	if (total <= height) {
		// Everything fits — no scrolling needed.
		return { startIndex: 0, totalRows: total };
	}

	// Walk from the bottom, accumulating rows until we've filled `height`.
	// Then optionally back up by `offset` rows.
	const overshoot = total - height - offset;
	if (overshoot <= 0) {
		// Scrolled to (or past) the bottom of the visible window.
		return { startIndex: 0, totalRows: total };
	}

	let rowsFromBottom = 0;
	let start = items.length;
	for (let i = items.length - 1; i >= 0; i--) {
		rowsFromBottom += itemHeights[i] ?? 0;
		if (rowsFromBottom > overshoot) {
			start = i;
			break;
		}
		start = i;
	}
	return { startIndex: Math.max(0, start), totalRows: total };
}

/** Render a single visual item (item + leading separator) into rows. */
export function flattenItemRows(
	items: ChatItem[],
	renderItem: (item: ChatItem, width: number) => string[],
	width: number,
	separator: string = "",
): { rows: string[]; heights: number[] } {
	const rows: string[] = [];
	const heights: number[] = [];
	for (let i = 0; i < items.length; i++) {
		if (i > 0 && separator) {
			rows.push(separator.padEnd(width, " "));
			heights.push(1);
		}
		const itemRows = renderItem(items[i]!, width);
		rows.push(...itemRows);
		heights.push(itemRows.length);
	}
	return { rows, heights };
}
