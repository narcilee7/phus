// test/llm-fuse.test.ts
// The fuse guards the API budget — lock in classification, fuse
// open/close, and both budget windows with injected time.

import { describe, it, expect } from "vitest";
import { LlmFuse, LlmFuseError, DEFAULT_ROBUSTNESS } from "../src/infra/llm-fuse.js";

function makeFuse(overrides: Partial<typeof DEFAULT_ROBUSTNESS> = {}) {
	let now = 1_000_000;
	const cfg = { ...DEFAULT_ROBUSTNESS, billingFuseMs: 600_000, ...overrides };
	const fuse = new LlmFuse(
		() => cfg,
		() => now,
	);
	return { fuse, advance: (ms: number) => { now += ms; } };
}

describe("LlmFuse", () => {
	it("passes calls through when closed", () => {
		const { fuse } = makeFuse();
		expect(() => fuse.check()).not.toThrow();
		expect(fuse.isOpen()).toBe(false);
	});

	it("opens the billing fuse on a 402 and fails fast afterwards", () => {
		const { fuse, advance } = makeFuse({ billingFuseMs: 600_000 });
		fuse.report(new Error("402 Insufficient Balance"));
		expect(fuse.isOpen()).toBe(true);
		expect(() => fuse.check()).toThrowError(LlmFuseError);
		expect(() => fuse.check()).toThrowError(/fuse open/);
		// And no further calls are counted while open (fast-fail, zero burn).
		const before = fuse.status().callsThisHour;
		expect(() => fuse.check()).toThrowError(LlmFuseError);
		expect(fuse.status().callsThisHour).toBe(before);

		advance(600_001);
		expect(fuse.isOpen()).toBe(false);
		expect(() => fuse.check()).not.toThrow();
	});

	it("classifies billing variants", () => {
		for (const msg of ["insufficient_balance", "quota exceeded", "Billing hard limit reached", "余额不足"]) {
			const { fuse } = makeFuse();
			fuse.report(new Error(msg));
			expect(fuse.isOpen()).toBe(true);
		}
	});

	it("does not open on rate limits or network errors", () => {
		const { fuse } = makeFuse();
		fuse.report(new Error("429 rate limit"));
		fuse.report(new Error("ECONNRESET"));
		expect(fuse.isOpen()).toBe(false);
	});

	it("enforces the per-turn budget and resets on resetTurn", () => {
		const { fuse } = makeFuse({ llmCallsPerTurn: 3, llmCallsPerHour: 0 });
		fuse.resetTurn();
		fuse.check();
		fuse.check();
		fuse.check();
		expect(() => fuse.check()).toThrowError(/turn/);
		fuse.resetTurn();
		expect(() => fuse.check()).not.toThrow();
	});

	it("enforces the rolling hourly budget", () => {
		const { fuse, advance } = makeFuse({ llmCallsPerTurn: 0, llmCallsPerHour: 3 });
		fuse.check();
		fuse.check();
		fuse.check();
		expect(() => fuse.check()).toThrowError(/hour/);
		advance(3_600_001);
		expect(() => fuse.check()).not.toThrow();
	});

	it("0 disables a budget", () => {
		const { fuse } = makeFuse({ llmCallsPerTurn: 0, llmCallsPerHour: 0 });
		for (let i = 0; i < 100; i++) fuse.check();
		expect(fuse.isOpen()).toBe(false);
	});

	it("status() reports counters", () => {
		const { fuse } = makeFuse();
		fuse.check();
		fuse.check();
		const s = fuse.status();
		expect(s.callsThisTurn).toBe(2);
		expect(s.callsThisHour).toBe(2);
		expect(s.open).toBe(false);
	});
});
