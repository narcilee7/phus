// src/tui/runtime/sisyphus.ts
// Sisyphus-themed busy animation. The stone is pushed up the hill,
// crosses the peak, rolls back down to the bottom — and the loop
// starts over. "Every turn repeats, every turn grows."
//
// The animator is a pure frame/verb source with a 150ms ticker. The
// App starts it while a turn is busy and stops it on idle, so the
// TUI only repaints at animation rate when something is happening.

/** Rolling-stone loop, 10 frames × 10 columns. The hill `╱╲` is fixed
 *  at the center; the stone `●` walks up the left slope, crosses the
 *  peak, and rolls down the right side back to the start. */
export const STONE_FRAMES: readonly string[] = [
	"●╌╌╌╱╲╌╌╌╌",
	"╌●╌╌╱╲╌╌╌╌",
	"╌╌●╌╱╲╌╌╌╌",
	"╌╌╌●╱╲╌╌╌╌",
	"╌╌╌╱●╲╌╌╌╌",
	"╌╌╌╱╲●╌╌╌╌",
	"╌╌╌╱╲╌●╌╌╌",
	"╌╌╌╱╲╌╌●╌╌",
	"╌╌╌╱╲╌╌╌●╌",
	"╌╌╌╱╲╌╌╌╌●",
];

/** Verbs rotated while the agent works — Sisyphus never does the same
 *  push twice. */
export const PUSH_VERBS = ["pushing", "heaving", "rolling", "climbing", "sweating"] as const;

export const STONE_TICK_MS = 150;
const TICKS_PER_VERB = 14; // ≈2.1s per verb at 150ms

export class SisyphusAnimator {
	private tick = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly subscribers = new Set<() => void>();

	/** Subscribe to frame changes. Returns an unsubscribe fn. */
	onTick(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.tick++;
			for (const fn of this.subscribers) fn();
		}, STONE_TICK_MS);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.tick = 0;
	}

	get running(): boolean {
		return this.timer !== undefined;
	}

	/** Current animation frame (raw string; callers colorize). */
	frame(): string {
		return STONE_FRAMES[this.tick % STONE_FRAMES.length] ?? STONE_FRAMES[0]!;
	}

	/** Current push verb, rotated every TICKS_PER_VERB ticks. */
	verb(): string {
		return PUSH_VERBS[Math.floor(this.tick / TICKS_PER_VERB) % PUSH_VERBS.length] ?? PUSH_VERBS[0];
	}
}
