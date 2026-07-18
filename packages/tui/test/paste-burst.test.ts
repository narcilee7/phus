// test/tui/paste-burst.test.ts
// Unit tests for the paste-burst detector. Ported from
// @moonshot-ai/pi-tui (MIT). Verifies the heuristics match the upstream
// behavior so we don't regress.

import { describe, expect, it } from "vitest";
import { PasteBurst } from "../src/runtime/paste-burst.js";

describe("PasteBurst", () => {
	it("does not suppress Enter when no characters have arrived", () => {
		const burst = new PasteBurst();
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1000)).toBe(false);
	});

	it("does not suppress Enter after a slow sequence of characters", () => {
		const burst = new PasteBurst();
		// 8 chars at 50ms intervals — normal fast typing, not a paste burst.
		for (let i = 0; i < 8; i++) burst.onPlainChar(1000 + i * 50);
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1500)).toBe(false);
	});

	it("suppresses Enter when ≥8 chars arrive within 8ms of each other", () => {
		const burst = new PasteBurst();
		for (let i = 0; i < 8; i++) burst.onPlainChar(1000 + i * 4);
		// Enter arriving during the burst window should insert a newline.
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1020)).toBe(true);
	});

	it("keeps Enter suppressed for 120ms after the last burst char", () => {
		const burst = new PasteBurst();
		for (let i = 0; i < 10; i++) burst.onPlainChar(1000 + i * 4);
		// Last char at t=1036. Enter at t=1100 (64ms later) is within the
		// 120ms suppress window.
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1100)).toBe(true);
		// Enter at t=1200 (164ms later) is past the suppress window.
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1200)).toBe(false);
	});

	it("reset() clears all burst state", () => {
		const burst = new PasteBurst();
		for (let i = 0; i < 10; i++) burst.onPlainChar(1000 + i * 4);
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1020)).toBe(true);
		burst.reset();
		expect(burst.shouldInsertNewlineInsteadOfSubmit(1020)).toBe(false);
	});
});