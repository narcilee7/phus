// src/tui/runtime/spinner.ts
// Self-driving animated spinner. Implements pi-tui's Component
// interface and re-requests render on each tick via a global hook
// (wired up by the App instance — see runtime/app-state.ts).
//
// We don't hold a direct reference to the TUI: the spinner increments
// its frame and calls a registered invalidator. The TUI's render loop
// picks up the change on the next tick (≤16ms by default).

import type { Component } from "@/vendor/pi-tui/tui.js";
import { colorize } from "@/runtime/text-utils.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸"];

export class Spinner implements Component {
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private subscribers = new Set<() => void>();
	constructor(private readonly color: string = "cyan") {}

	/** Subscribe to frame changes. Returns an unsubscribe fn. */
	onTick(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % FRAMES.length;
			for (const fn of this.subscribers) fn();
		}, 120);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	invalidate(): void {
		// No cached state — the next render() reads `frame` directly.
	}

	render(width: number): string[] {
		// A spinner is a single glyph. Surround with a space so it doesn't
		// collide with adjacent borders.
		const glyph = FRAMES[this.frame] ?? FRAMES[0]!;
		const out = " " + colorize(glyph, this.color) + " ";
		return [out.padEnd(Math.max(out.length, width), " ")];
	}
}
