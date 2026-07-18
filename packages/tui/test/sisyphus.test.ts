// test/sisyphus.test.ts
// The rolling-stone animator drives every busy surface; lock in the
// frame cycle, verb rotation, and start/stop lifecycle.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	SisyphusAnimator,
	STONE_FRAMES,
	PUSH_VERBS,
	STONE_TICK_MS,
} from "@/runtime/sisyphus.js";
import { visibleWidth } from "@/runtime/text-utils.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("SisyphusAnimator", () => {
	it("cycles frames on each tick", () => {
		vi.useFakeTimers();
		const a = new SisyphusAnimator();
		const seen: string[] = [];
		a.onTick(() => seen.push(a.frame()));
		a.start();
		vi.advanceTimersByTime(STONE_TICK_MS * 3);
		a.stop();
		expect(seen.length).toBe(3);
		expect(seen[0]).toBe(STONE_FRAMES[1]);
		expect(seen[1]).toBe(STONE_FRAMES[2]);
		expect(seen[2]).toBe(STONE_FRAMES[3]);
	});

	it("wraps the frame loop", () => {
		vi.useFakeTimers();
		const a = new SisyphusAnimator();
		a.start();
		vi.advanceTimersByTime(STONE_TICK_MS * STONE_FRAMES.length);
		expect(a.frame()).toBe(STONE_FRAMES[0]);
		a.stop();
	});

	it("rotates verbs every ~14 ticks", () => {
		vi.useFakeTimers();
		const a = new SisyphusAnimator();
		expect(a.verb()).toBe(PUSH_VERBS[0]);
		a.start();
		vi.advanceTimersByTime(STONE_TICK_MS * 14);
		expect(a.verb()).toBe(PUSH_VERBS[1]);
		a.stop();
	});

	it("stop resets the tick and halts notifications", () => {
		vi.useFakeTimers();
		const a = new SisyphusAnimator();
		let ticks = 0;
		a.onTick(() => ticks++);
		a.start();
		vi.advanceTimersByTime(STONE_TICK_MS * 5);
		a.stop();
		const afterStop = ticks;
		vi.advanceTimersByTime(STONE_TICK_MS * 5);
		expect(ticks).toBe(afterStop);
		expect(a.frame()).toBe(STONE_FRAMES[0]);
		expect(a.running).toBe(false);
	});

	it("every frame is exactly 10 columns wide (frame budget safety)", () => {
		for (const f of STONE_FRAMES) {
			expect(visibleWidth(f)).toBe(10);
		}
	});
});
