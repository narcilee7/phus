// src/tui/runtime/scroll.ts
// Helpers for bottom-anchored chat scroll math.

import type { ChatItem } from "@/state/state.js";

export interface ScrollPosition {
	/** Index into the rendered item list that the top row corresponds to. */
	startIndex: number;
	/** Rows to skip inside `items[startIndex]` so the window's top edge
	 *  aligns to the middle of that item. 0 when the boundary is exact. */
	skipRows: number;
	/** Total number of rows the rendered item list would occupy if the
	 *  viewport were tall enough. Used for "↑ N more" indicators. */
	totalRows: number;
}

/**
 * Compute which items fit into a viewport of `height` rows, anchored to
 * the bottom, given a scroll offset (lines from the bottom).
 *
 *   const { startIndex, skipRows, totalRows } = bottomAnchoredSlice(items, itemHeights, height, offset);
 *
 * `itemHeights[i]` is the rendered height (rows) of item `i`. The visible
 * window is the row range `[totalRows - height - offset, totalRows - offset)`;
 * `startIndex` + `skipRows` locate the window's top edge inside the item
 * list (item-granular, so partial items at the edge are expected).
 */
export function bottomAnchoredSlice(
	items: ChatItem[],
	itemHeights: number[],
	height: number,
	offset: number,
): ScrollPosition {
	const total = itemHeights.reduce((a, h) => a + h, 0);
	if (height <= 0 || items.length === 0 || total <= height) {
		// Everything fits (or nothing to show) — no scrolling needed.
		return { startIndex: 0, skipRows: 0, totalRows: total };
	}

	// Rows the window must cover, measured up from the bottom of the
	// content: the viewport height plus the rows scrolled away below.
	const want = height + Math.max(0, offset);
	let rowsFromBottom = 0;
	let start = 0;
	for (let i = items.length - 1; i >= 0; i--) {
		rowsFromBottom += itemHeights[i] ?? 0;
		if (rowsFromBottom >= want) {
			start = i;
			// Skip the rows of `items[i]` that lie above the window's top
			// edge. Negative (scrolled past the top) clamps to 0.
			return {
				startIndex: start,
				skipRows: Math.max(0, rowsFromBottom - want),
				totalRows: total,
			};
		}
	}
	// Scrolled past the very top — show from the first item.
	return { startIndex: 0, skipRows: 0, totalRows: total };
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
