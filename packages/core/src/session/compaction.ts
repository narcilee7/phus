// packages/runtime/src/core/session/compaction.ts
// Manual Tape compaction: summarize old turns into an anchor, keep recent N.
// Pure: no Pi imports. The MetaTool wrapper (`compact_session`) and the
// LLM-backed summarizer (`llmSummarizer`) live in
// `@phus/runtime/llm/compact-tool.ts`.

import type { Tape } from "./tape.js";
import type { Turn } from "../types/tape/index.js";
import { asSessionId } from "../types/brand.js";
import type { SessionId } from "../types/brand.js";

export interface CompactionResult {
	sessionId: string;
	keptRecent: number;
	summarized: number;
	anchorName: string;
	summary: string;
	durationMs: number;
}

/**
 * Compact a session's tape. Returns a summary anchor + the count of turns
 * that were summarized (marked as compacted but not deleted).
 */
export async function compactSession(
	tape: Tape,
	sessionId: SessionId,
	options: {
		/** Keep this many most-recent turns intact. Default 10. */
		keepRecent?: number;
		/** Pre-built Agent to use for summarization. If omitted, returns the turns. */
		summarizeWith?: (turns: Turn[]) => Promise<string>;
	} = {},
): Promise<CompactionResult> {
	const startedAt = Date.now();
	const keepRecent = options.keepRecent ?? 10;

	// Collect all turns in chronological order.
	const allTurns: Turn[] = [];
	for (const entry of tape.replay(sessionId)) {
		if (entry.kind === "turn") allTurns.push(entry.turn);
	}

	if (allTurns.length <= keepRecent) {
		return {
			sessionId,
			keptRecent: allTurns.length,
			summarized: 0,
			anchorName: `compact-${Date.now()}`,
			summary: "(nothing to compact)",
			durationMs: Date.now() - startedAt,
		};
	}

	const toSummarize = allTurns.slice(0, allTurns.length - keepRecent);
	const recentKept = allTurns.slice(-keepRecent);

	// Summarize via the provided agent or fall back to a simple concatenation.
	let summary: string;
	if (options.summarizeWith) {
		summary = await options.summarizeWith(toSummarize);
	} else {
		summary = simpleSummarize(toSummarize);
	}

	const anchorName = `compact-${Date.now()}`;
	tape.append({
		kind: "anchor",
		sessionId: asSessionId(sessionId),
		name: anchorName,
		state: {
			kind: "compaction",
			summarizedCount: toSummarize.length,
			keptRecentCount: recentKept.length,
			summary,
			turnIds: toSummarize.map((t) => t.id),
		},
		args: { summarizedCount: toSummarize.length, keptRecentCount: recentKept.length },
		ts: Date.now(),
	});

	  /* logger call removed: logger.info(... */

	return {
		sessionId,
		keptRecent: recentKept.length,
		summarized: toSummarize.length,
		anchorName,
		summary,
		durationMs: Date.now() - startedAt,
	};
}

/** Build a deterministic textual summary without calling an LLM. */
export function simpleSummarize(turns: Turn[]): string {
	const lines = turns.map((t) => {
		const u = (t.inbound.content ?? "").slice(0, 120).replace(/\n/g, " ");
		const r = (t.modelOutput ?? "").slice(0, 120).replace(/\n/g, " ");
		return `[${new Date(t.ts).toISOString().slice(0, 16)}] U: ${u} | P: ${r}`;
	});
	return `Compacted ${turns.length} turn(s):\n\n${lines.join("\n")}`;
}
