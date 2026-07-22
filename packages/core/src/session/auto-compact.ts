// src/session/auto-compact.ts
// Automatic tape compaction triggered by context size / token estimate.
//
// Wired into the runtime's `transformContext` (Pi Agent hook) so it
// fires before every LLM call. The function returns a `trimmedMessages`
// slice (summary + recent N) that the caller assigns to the live
// `piAgent.state.messages` — the compaction must actually shorten the
// next request, not just write an anchor to the tape.

import type { Tape } from "./tape.js";
import { compactSession, buildSummaryMessage } from "./compaction.js";
import type { Turn } from "../types/tape/index.js";
import { asSessionId } from "../types/brand.js";
import type { SessionId } from "../types/brand.js";
import {
	buildSnapshot,
	classifyTier,
	NOOP_BUDGET_LOGGER,
	type BudgetLogger,
	type ContextBudgetConfig,
	type ContextSnapshot,
	type ContextTier,
} from "./context-budget.js";

export interface AutoCompactConfig {
	/** Hard cap on the number of in-memory messages. Activates when
	 *  `contextWindow` is missing (some gateway stubs) or as a safety
	 *  net when token estimation is way off. Default: 100. */
	maxMessages: number;
	/** Fraction of the **input budget** (`contextWindow - maxOutputTokens`)
	 *  at which to trigger compaction. 0.6 leaves room for output +
	 *  tool-call expansion. Default: 0.6. */
	maxContextFraction: number;
	/** Keep this many most-recent turns around the summary. Default: 10. */
	keepRecent: number;
	/** Fraction at which to emit a `context.near_limit` log event WITHOUT
	 *  committing to a compact. Default: 0.5. */
	warnFraction: number;
	/** Override the model's reported `maxOutputTokens` for budget math.
	 *  Useful when a provider's `maxTokens` is wrong. 0 = use the model's
	 *  reported value. Default: 0. */
	reserveOutputTokens: number;
}

export const DEFAULT_AUTO_COMPACT: AutoCompactConfig = {
	maxMessages: 100,
	maxContextFraction: 0.6,
	keepRecent: 10,
	warnFraction: 0.5,
	reserveOutputTokens: 0,
};

/** Logger interface used by `maybeCompact`. Core takes a narrow shape
 *  so the runtime can pass `logger` from pino without dragging
 *  structured-logging types into the core module. */
export interface CompactLogger {
	info: (event: string, payload?: Record<string, unknown>) => void;
	warn: (event: string, payload?: Record<string, unknown>) => void;
}

export const NOOP_COMPACT_LOGGER: CompactLogger = {
	info: () => {},
	warn: () => {},
};

/** Inputs to `maybeCompact`. Single-object signature so the caller
 *  doesn't trip over argument-order changes when new optional fields
 *  are added. */
export interface CompactArgs {
	tape: Tape;
	sessionId: SessionId | string;
	messages: unknown[];
	contextWindow: number | undefined;
	cfg?: AutoCompactConfig;
	/** Inferred from the model's `maxTokens` at call time. */
	maxOutputTokens?: number;
	/** The composed system prompt (built by `buildContextBlock`). */
	systemPrompt?: string;
	/** Tool definitions (TypeBox schemas). Will be JSON-serialized. */
	tools?: unknown[];
	/** API-reported input tokens from the previous turn. When present,
	 *  this overrides the heuristic and uses the real number. */
	lastReportedInput?: number;
	/** Plumbed through to `compactSession`. When set, the LLM-backed
	 *  summarizer is used instead of the deterministic `simpleSummarize`. */
	summarizeWith?: (turns: Turn[]) => Promise<string>;
	logger?: CompactLogger;
}

export interface CompactDecision {
	/** True iff compaction actually ran. The caller should apply
	 *  `trimmedMessages` to the live messages array when this is true. */
	fired: boolean;
	/** Tier classification. `'ok'` (no compact), `'near_limit'` (warn,
	 *  no compact), or `'compact'` (compact fired). */
	tier: ContextTier;
	/** Human-readable reason — populated when `fired` is true. */
	reason?: string;
	summarized?: number;
	kept?: number;
	anchorName?: string;
	/** The replacement messages list. Contains the summary message
	 *  followed by the most recent `keepRecent` messages. Undefined
	 *  when `fired` is false. */
	trimmedMessages?: unknown[];
	/** The full snapshot for diagnostics / logging. */
	snapshot: ContextSnapshot;
}

/** Decide whether the current context warrants a compact, and if so
 *  run the compaction and return the trimmed message list. The caller
 *  is responsible for assigning `trimmedMessages` to the live
 *  `piAgent.state.messages`. */
export async function maybeCompact(args: CompactArgs): Promise<CompactDecision> {
	const cfg = args.cfg ?? DEFAULT_AUTO_COMPACT;
	const logger = args.logger ?? NOOP_COMPACT_LOGGER;
	const budgetLogger: BudgetLogger = {
		warn: (event, payload) => logger.warn(event, payload),
	};
	const effectiveMaxOutput = cfg.reserveOutputTokens || args.maxOutputTokens || 0;

	const snapshot = buildSnapshot(
		{
			contextWindow: args.contextWindow,
			maxOutputTokens: effectiveMaxOutput,
			systemPrompt: args.systemPrompt,
			tools: args.tools,
			messages: args.messages,
			reportedInput: args.lastReportedInput,
		},
		budgetLogger,
	);
	const budgetConfig: ContextBudgetConfig = {
		warnFraction: cfg.warnFraction,
		maxContextFraction: cfg.maxContextFraction,
	};
	const tier = classifyTier(snapshot, budgetConfig);

	// Fallback: maxMessages safety net triggers a compact even when
	// `contextWindow` is missing (e.g. gateway stub). Skip if the budget
	// tier already qualifies for compact to avoid double-compaction.
	const overMaxMessages = args.messages.length > cfg.maxMessages;
	if (tier !== "compact" && overMaxMessages) {
		return runCompact(args, cfg, "compact", snapshot, logger);
	}

	if (tier === "compact") {
		const reason =
			`tokens=${snapshot.total} / inputBudget=${snapshot.inputBudget} ` +
			`(${(snapshot.ratio * 100).toFixed(1)}%) >= ${cfg.maxContextFraction * 100}%`;
		return runCompact(args, cfg, "compact", snapshot, logger, reason);
	}

	if (tier === "near_limit") {
		logger.info("context.near_limit", {
			tier,
			ratio: snapshot.ratio,
			tokens: snapshot.total,
			contextWindow: snapshot.contextWindow,
			inputBudget: snapshot.inputBudget,
		});
	}

	return { fired: false, tier, snapshot };
}

/** Backward-compat helper for code that only has the message array
 *  and wants a quick yes/no. Uses the OLD heuristic (message tokens /
 *  contextWindow) — kept for the existing test suite; the runtime
 *  should use `maybeCompact` instead. */
export function shouldCompact(
	messages: unknown[],
	contextWindow: number | undefined,
	cfg: AutoCompactConfig = DEFAULT_AUTO_COMPACT,
): string | null {
	if (messages.length > cfg.maxMessages) {
		return `messages.length=${messages.length} > maxMessages=${cfg.maxMessages}`;
	}
	if (contextWindow && contextWindow > 0) {
		const tokens = estimateTokens(messages);
		const fraction = tokens / contextWindow;
		if (fraction > cfg.maxContextFraction) {
			return `tokens=${tokens} / contextWindow=${contextWindow} = ${(fraction * 100).toFixed(1)}% > ${cfg.maxContextFraction * 100}%`;
		}
	}
	return null;
}

/**
 * Estimate token count from messages.
 * Rough heuristic: ~4 chars per token. For real counting, use a tokenizer,
 * but this is good enough for threshold decisions.
 */
export function estimateTokens(messages: unknown[]): number {
	let chars = 0;
	for (const m of messages) {
		if (!m || typeof m !== "object") continue;
		const msg = m as any;
		if (typeof msg.content === "string") {
			chars += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const c of msg.content) {
				if (typeof c === "string") chars += c.length;
				else if (c && typeof c === "object" && typeof c.text === "string") chars += c.text.length;
			}
		}
		chars += 50; // overhead per message
	}
	return Math.ceil(chars / 4);
}

// ─── internals ─────────────────────────────────────────────────────

async function runCompact(
	args: CompactArgs,
	cfg: AutoCompactConfig,
	tier: ContextTier,
	snapshot: ContextSnapshot,
	logger: CompactLogger,
	reason?: string,
): Promise<CompactDecision> {
	try {
		const result = await compactSession(args.tape, asSessionId(String(args.sessionId)), {
			keepRecent: cfg.keepRecent,
			summarizeWith: args.summarizeWith,
		});
		const summary = result.summaryMessage ?? buildSummaryMessage(result.summary, {
			anchorName: result.anchorName,
			summarizedCount: result.summarized,
		});
		const trimmed = args.messages.slice(-cfg.keepRecent);
		const trimmedMessages = [summary, ...trimmed];
		const finalReason =
			reason ??
			`summarized=${result.summarized} kept=${result.keptRecent} maxMessages`;
		logger.info("context.compacting", {
			tier,
			reason: finalReason,
			tokens: snapshot.total,
			inputBudget: snapshot.inputBudget,
			ratio: snapshot.ratio,
			summarized: result.summarized,
			kept: result.keptRecent,
			anchorName: result.anchorName,
		});
		return {
			fired: true,
			tier,
			reason: finalReason,
			summarized: result.summarized,
			kept: result.keptRecent,
			anchorName: result.anchorName,
			trimmedMessages,
			snapshot,
		};
	} catch (err) {
		logger.warn("compact.failed", {
			tier,
			reason,
			error: err instanceof Error ? err.message : String(err),
		});
		return { fired: false, tier, snapshot };
	}
}
