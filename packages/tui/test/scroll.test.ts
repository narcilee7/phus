// test/scroll.test.ts
// Regression tests for the bottom-anchored scroll math and the
// multi-line system-item rendering — both corrupted the live frame:
// the slice showed stale middle content instead of the newest rows,
// and system notices with \n rendered as a single "row".

import { describe, it, expect } from "vitest";
import { bottomAnchoredSlice } from "@/runtime/scroll.js";
import { ChatViewport } from "@/components/chat/ChatViewport.js";
import { ChatItemView } from "@/components/chat/ChatItemView.js";
import type { ChatItem } from "@/state/state.js";

const item = (kind: ChatItem["kind"], text: string): ChatItem =>
	({ kind, id: Math.random().toString(36), text, ts: Date.now() }) as ChatItem;

describe("bottomAnchoredSlice", () => {
	// 10 items × 3 rows = 30 rows total, viewport 10 rows.
	const items = Array.from({ length: 10 }, (_, i) => item("user", `m${i}`));
	const heights = Array(10).fill(3);

	it("anchors to the bottom at offset 0", () => {
		const r = bottomAnchoredSlice(items, heights, 10, 0);
		// Window = last 10 rows: item 6 rows 2..3, then items 7-9.
		expect(r.startIndex).toBe(6);
		expect(r.skipRows).toBe(2);
		expect(r.totalRows).toBe(30);
	});

	it("scrolls up by offset rows", () => {
		const r = bottomAnchoredSlice(items, heights, 10, 5);
		// Window = rows [15, 25): starts exactly at item 5.
		expect(r.startIndex).toBe(5);
		expect(r.skipRows).toBe(0);
	});

	it("clamps when scrolled past the top", () => {
		const r = bottomAnchoredSlice(items, heights, 10, 100);
		expect(r.startIndex).toBe(0);
		expect(r.skipRows).toBe(0);
	});

	it("returns startIndex 0 when everything fits", () => {
		const r = bottomAnchoredSlice(items.slice(0, 2), [3, 3], 10, 0);
		expect(r.startIndex).toBe(0);
		expect(r.totalRows).toBe(6);
	});
});

describe("ChatViewport windowing", () => {
	const render = (items: ChatItem[], height: number, scrollOffset = 0) => {
		const viewport = new ChatViewport({
			items,
			scrollOffset,
			hasNew: false,
			fileSnapshots: new Map(),
		});
		viewport.setHeight(height);
		return viewport.render(40);
	};

	it("shows the newest rows when content overflows", () => {
		// One tall assistant item (30 rows) followed by a short one.
		const tall = item("user", Array.from({ length: 30 }, (_, i) => `row${i}`).join("\n"));
		const tail = item("user", "newest");
		const lines = render([tall, tail], 10);
		expect(lines.length).toBe(10);
		// Bottom-anchored: the last content row must be the newest item.
		expect(lines.some((l) => l.includes("newest"))).toBe(true);
		expect(lines.some((l) => l.includes("row29"))).toBe(true);
		// And the window shows the END of the tall item, not its start.
		expect(lines[0]).not.toContain("row0");
	});

	it("honours scrollOffset (window moves up)", () => {
		const tall = item("user", Array.from({ length: 30 }, (_, i) => `row${i}`).join("\n"));
		const lines = render([tall], 10, 20);
		expect(lines.length).toBe(10);
		// offset 20 → window = rows [30-10-20, 30-20) = rows 0..9.
		expect(lines[0]).toContain("row0");
		expect(lines[9]).toContain("row9");
	});
});

describe("ChatItemView system items", () => {
	it("splits multi-line text into one rendered row per line", () => {
		const view = new ChatItemView(item("system", "line1\nline2\nline3"), undefined);
		const rows = view.render(80);
		expect(rows.length).toBe(3);
		expect(rows[0]).toContain("line1");
		expect(rows[1]).toContain("line2");
		expect(rows[2]).toContain("line3");
	});

	it("wraps long lines to the viewport width", () => {
		const view = new ChatItemView(item("system", "x".repeat(200)), undefined);
		const rows = view.render(50);
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) {
			// No row may exceed the render width — overflowing rows corrupt
			// the differential frame (row-addressed repaint misaligns).
			expect(row.replace(/\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(50);
		}
	});
});
