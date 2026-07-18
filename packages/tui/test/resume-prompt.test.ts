// test/resume-prompt.test.ts
// The startup resume prompt is the explicit entry point for durable
// plans — lock in its rendering and key routing.

import { describe, it, expect } from "vitest";
import { ResumePrompt } from "@/components/agent/ResumePrompt.js";
import type { Plan } from "@phus/runtime/core/runtime/plan/types.js";

function makePlan(id: string, goal: string, doneSteps = 0, totalSteps = 3): Plan {
	return {
		id,
		sessionId: "tui:tui" as Plan["sessionId"],
		goal,
		status: "paused",
		steps: Array.from({ length: totalSteps }, (_, i) => ({
			id: `s${i}`,
			index: i,
			description: `step ${i}`,
			status: i < doneSteps ? "completed" : "pending",
			retryCount: 0,
		})),
		createdAt: 1,
		updatedAt: Date.now(),
	} as Plan;
}

describe("ResumePrompt", () => {
	it("renders the title and one row per plan with step counts", () => {
		const prompt = new ResumePrompt(
			[makePlan("p1", "write haikus", 1, 3)],
			() => {},
			() => {},
			() => {},
		);
		const lines = prompt.render(100);
		expect(lines[0]).toContain("interrupted plans");
		expect(lines.some((l) => l.includes("write haikus"))).toBe(true);
		expect(lines.some((l) => l.includes("1/3 steps"))).toBe(true);
	});

	it("Enter resumes the selected plan", () => {
		let resumed: string | undefined;
		const prompt = new ResumePrompt(
			[makePlan("p1", "a"), makePlan("p2", "b")],
			(id) => { resumed = id; },
			() => {},
			() => {},
		);
		prompt.handleInput("\r"); // Enter
		expect(resumed).toBe("p1");
	});

	it("x abandons the selected plan", () => {
		let abandoned: string | undefined;
		const prompt = new ResumePrompt(
			[makePlan("p1", "a")],
			() => {},
			(id) => { abandoned = id; },
			() => {},
		);
		prompt.handleInput("x");
		expect(abandoned).toBe("p1");
	});

	it("d dismisses without touching any plan", () => {
		let closed = false;
		let resumed: string | undefined;
		const prompt = new ResumePrompt(
			[makePlan("p1", "a")],
			(id) => { resumed = id; },
			() => {},
			() => { closed = true; },
		);
		prompt.handleInput("d");
		expect(closed).toBe(true);
		expect(resumed).toBeUndefined();
	});
});
