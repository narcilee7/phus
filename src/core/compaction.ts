// src/core/compaction.ts
// Manual Tape compaction: summarize old turns into an anchor, keep recent N.
// Triggered by:
//   - agent calling `compact_session` meta tool
//   - `phus compact <sessionId>` CLI command

import type { Agent } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Tape } from "./tape.js";
import type { MetaTool, TapeEntry, Turn } from "./types.js";
import { logger } from "./logger.js";

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
  sessionId: string,
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
    sessionId,
    name: anchorName,
    state: {
      kind: "compaction",
      summarizedCount: toSummarize.length,
      keptRecentCount: recentKept.length,
      summary,
      turnIds: toSummarize.map((t) => t.id),
    },
    ts: Date.now(),
  });

  logger.info("compaction.completed", {
    sessionId,
    summarized: toSummarize.length,
    keptRecent: recentKept.length,
    durationMs: Date.now() - startedAt,
  });

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
function simpleSummarize(turns: Turn[]): string {
  const lines = turns.map((t) => {
    const u = (t.inbound.content ?? "").slice(0, 120).replace(/\n/g, " ");
    const r = (t.modelOutput ?? "").slice(0, 120).replace(/\n/g, " ");
    return `[${new Date(t.ts).toISOString().slice(0, 16)}] U: ${u} | P: ${r}`;
  });
  return `Compacted ${turns.length} turn(s):\n\n${lines.join("\n")}`;
}

/** Meta tool that lets the agent compact its own session on demand. */
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
      const sessionId = args.sessionId ? String(args.sessionId) : "";
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

    const events: string[] = [];
    await agent.prompt(messages as any);
    const last = [...agent.state.messages].reverse().find((m) => m.role === "assistant");
    if (!last) return simpleSummarize(turns);
    const text = (last as any).content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("") ?? "";
    return text || simpleSummarize(turns);
  };
}
