// src/infra/llm-fuse.ts
// Process-level circuit breaker + call budget for every outbound LLM
// request. Born from a real incident: a runaway plan loop kept burning
// API calls until the provider account hit 402 Insufficient Balance.
//
// Three independent guards:
//   1. billing fuse  — a 402/billing error opens the fuse for
//      `billingFuseMs`; while open, every call fails fast with zero
//      requests sent (a dead account can't be re-charged by retrying).
//   2. per-turn budget — `llmCallsPerTurn` caps requests inside one
//      turn (including SDK retries), so a `while(true)` tool loop has
//      a hard ceiling.
//   3. hourly budget — `llmCallsPerHour` rolling-window cap across
//      turns / plans / validators.
//
// All knobs come from `robustness:` in phus.config.yaml; 0 disables a
// budget. The fuse is checked BEFORE the request is sent (via the
// model's onPayload hook), so tripping it costs nothing.

import { logger } from "@/infra/logging.js";

export interface RobustnessConfig {
	/** Per-HTTP-call timeout handed to the provider SDK (pi-ai Model.timeoutMs). */
	llmTimeoutMs: number;
	/** Wall-clock watchdog per turn. */
	turnTimeoutMs: number;
	/** Wall-clock timeout for one sub-agent run (plan step). */
	subagentTimeoutMs: number;
	/** Wall-clock budget for one plan run. */
	planTimeoutMs: number;
	/** Max executed steps in one plan run. */
	planMaxSteps: number;
	/** Max LLM requests per turn (0 = unlimited). */
	llmCallsPerTurn: number;
	/** Max LLM requests per rolling hour (0 = unlimited). */
	llmCallsPerHour: number;
	/** How long the billing fuse stays open after a 402-class error. */
	billingFuseMs: number;
}

export const DEFAULT_ROBUSTNESS: RobustnessConfig = {
	llmTimeoutMs: 120_000,
	turnTimeoutMs: 600_000,
	subagentTimeoutMs: 300_000,
	planTimeoutMs: 900_000,
	planMaxSteps: 25,
	llmCallsPerTurn: 50,
	llmCallsPerHour: 500,
	billingFuseMs: 600_000,
};

export type FuseTripReason = "billing" | "turn_budget" | "hour_budget";

export class LlmFuseError extends Error {
	override readonly name = "LlmFuseError";
	constructor(
		message: string,
		readonly reason: FuseTripReason,
	) {
		super(message);
	}
}

const BILLING_PATTERN = /402|insufficient[ _]?balance|quota exceeded|billing|余额不足|欠费/i;
const RATE_LIMIT_PATTERN = /429|rate.?limit/i;

export class LlmFuse {
	private billingOpenUntil = 0;
	private billingReason = "";
	private callsThisTurn = 0;
	private hourWindow: number[] = [];

	constructor(
		/** Fresh config read per check — robustness edits apply without
		 *  rebuilding the fuse. Avoids a static llm-fuse→config import cycle. */
		private readonly getCfg: () => RobustnessConfig,
		private readonly now: () => number = Date.now,
	) {}

	private get cfg(): RobustnessConfig {
		return this.getCfg();
	}

	/** Reset the per-turn counter — call at every turn start. */
	resetTurn(): void {
		this.callsThisTurn = 0;
	}

	/**
	 * Pre-flight check before EVERY outbound LLM request. Counts the call
	 * and throws LlmFuseError when a fuse is open or a budget is blown —
	 * the request is never sent, so tripping costs nothing.
	 */
	check(endpointLabel = "llm"): void {
		const now = this.now();
		if (now < this.billingOpenUntil) {
			const resume = new Date(this.billingOpenUntil).toTimeString().slice(0, 5);
			throw new LlmFuseError(
				`LLM fuse open (${this.billingReason}) — calls resume at ${resume}. Top up the provider account or wait.`,
				"billing",
			);
		}

		this.callsThisTurn++;
		this.hourWindow.push(now);
		const hourAgo = now - 3_600_000;
		while (this.hourWindow.length > 0 && this.hourWindow[0]! < hourAgo) {
			this.hourWindow.shift();
		}

		if (this.cfg.llmCallsPerTurn > 0 && this.callsThisTurn > this.cfg.llmCallsPerTurn) {
			logger.warn("llm.budget_exceeded", {
				scope: "turn",
				limit: this.cfg.llmCallsPerTurn,
				endpoint: endpointLabel,
			});
			throw new LlmFuseError(
				`LLM call budget exceeded for this turn (${this.cfg.llmCallsPerTurn} requests)`,
				"turn_budget",
			);
		}
		if (this.cfg.llmCallsPerHour > 0 && this.hourWindow.length > this.cfg.llmCallsPerHour) {
			logger.warn("llm.budget_exceeded", {
				scope: "hour",
				limit: this.cfg.llmCallsPerHour,
				endpoint: endpointLabel,
			});
			throw new LlmFuseError(
				`LLM hourly call budget exceeded (${this.cfg.llmCallsPerHour} requests/hour)`,
				"hour_budget",
			);
		}
	}

	/** Classify an error coming back from an LLM call and trip fuses. */
	report(err: unknown): void {
		const msg = err instanceof Error ? err.message : String(err);
		if (BILLING_PATTERN.test(msg)) {
			if (this.now() >= this.billingOpenUntil) {
				this.billingOpenUntil = this.now() + this.cfg.billingFuseMs;
				this.billingReason = "insufficient balance / billing";
				logger.warn("llm.fuse_opened", {
					reason: this.billingReason,
					untilMs: this.billingOpenUntil,
					error: msg.slice(0, 200),
				});
			}
			return;
		}
		if (RATE_LIMIT_PATTERN.test(msg)) {
			logger.warn("llm.rate_limited", { error: msg.slice(0, 200) });
		}
	}

	isOpen(): boolean {
		return this.now() < this.billingOpenUntil;
	}

	status(): {
		open: boolean;
		reason?: string;
		untilMs?: number;
		callsThisTurn: number;
		callsThisHour: number;
	} {
		const now = this.now();
		const hourAgo = now - 3_600_000;
		const open = now < this.billingOpenUntil;
		return {
			open,
			...(open ? { reason: this.billingReason, untilMs: this.billingOpenUntil } : {}),
			callsThisTurn: this.callsThisTurn,
			callsThisHour: this.hourWindow.filter((t) => t >= hourAgo).length,
		};
	}
}
