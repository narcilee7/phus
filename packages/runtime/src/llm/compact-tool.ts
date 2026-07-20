// packages/runtime/src/llm/compact-tool.ts
// Meta-tool wrappers around `compactSession` (the pure half lives in
// `@phus/core/session/compaction.ts`). Imports Pi types (Agent, Type) and
// MetaTool — runtime-side dependencies that core/ must not see.

import { Type } from "@mariozechner/pi-ai";
import type { Agent } from "@mariozechner/pi-agent-core";

import type { Tape } from "@phus/core/session/tape.js";
import { compactSession } from "@phus/core/session/compaction.js";
import type { TapeEntry, Turn } from "@phus/core/types/tape/index.js";
import type { MetaTool } from "@phus/runtime/types/tool.js";
import { asSessionId } from "@phus/core/types/brand.js";

/** Meta tool that lets the agent compact its own session on demand.
 *  The summarizer is injected by the caller (typically a Pi Agent
 *  through `llmSummarizer`). */
export function createCompactTool(
	tape: Tape,
	getSummarizer: () => Promise<(turns: Turn[]) => Promise<string>>,
): MetaTool {
	return {
		name: "compact_session",
		description:
			"Manually compact the current session's tape. Summarizes older turns " +
			"into an anchor and keeps the most recent turns intact. Use when the " +
			"session is getting long and you want to preserve context without " +
			"consuming tokens on raw history.",
		parameters: Type.Object({
			sessionId: Type.Optional(Type.String({ description: "Session to compact. Defaults to current." })),
			keepRecent: Type.Optional(Type.Number({ description: "How many recent turns to keep. Default 10." })),
		}),
		execute: async (args) => {
			const sessionId = asSessionId(args.sessionId ? String(args.sessionId) : "default");
			const keepRecent = args.keepRecent ? Number(args.keepRecent) : 10;
			const summarize = await getSummarizer();
			const result = await compactSession(tape, sessionId, { keepRecent, summarizeWith: summarize });
			return { ok: true, ...result };
		},
	};
}

/** Build an LLM-based summarizer from a Pi Agent. */
export function llmSummarizer(agent: Agent): (turns: Turn[]) => Promise<string> {
	return async (turns) => {
		const transcript = turns
			.map(
				(t) =>
					`User: ${t.inbound.content}\nPhus: ${t.modelOutput}${t.toolCalls.length ? `\n[tools: ${t.toolCalls.map((c) => c.name).join(", ")}]` : ""}`,
			)
			.join("\n\n---\n\n");

		const messages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text:
							`Summarize the following conversation in 3-6 sentences. Preserve any "user preferences", "decisions made", or "facts established" — these are the load-bearing context. Skip pleasantries. Output plain prose, no bullets.\n\nConversation:\n\n${transcript.slice(0, 8000)}`,
					},
				],
				timestamp: Date.now(),
			},
		];

		await agent.prompt(messages as any);
		const last = [...agent.state.messages].reverse().find((m) => m.role === "assistant");
		if (!last) return simpleSummarizeFallback(turns);
		const text = (last as any).content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("") ?? "";
		return text || simpleSummarizeFallback(turns);
	};
}

// Local fallback (the canonical simpleSummarize lives in core/session/compaction.ts
// and is not exported; we just need a deterministic shape for the edge cases).
function simpleSummarizeFallback(turns: Turn[]): string {
	const lines = turns.map((t) => {
		const u = (t.inbound.content ?? "").slice(0, 120).replace(/\n/g, " ");
		const r = (t.modelOutput ?? "").slice(0, 120).replace(/\n/g, " ");
		return `[${new Date(t.ts).toISOString().slice(0, 16)}] U: ${u} | P: ${r}`;
	});
	return `Compacted ${turns.length} turn(s):\n\n${lines.join("\n")}`;
}

// Keep TapeEntry reachable from the file (the original used it in
// `Turn` import chain); no-op re-export so future code that needs
// the local helper can grow without changing imports.
export type { TapeEntry };
