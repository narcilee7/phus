// src/bridge/prompt-assembly.ts
// System prompt + context injection. Runs on every LLM call via Pi's
// `transformContext` callback.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SkillRegistryLike, TapeLike } from "@phus/core/types/hooks/index.js";
import type { SessionId } from "@phus/core/types/brand.js";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";
import type { HookRegistry } from "@phus/core/runtime/hook/registry.js";
import type { RepoFileIndex } from "@phus/core/session/repo-file-index.js";
import { selectRelevantFiles } from "@phus/core/session/context-select.js";

export const SYSTEM_PROMPT_HEADER = `You are Phus (⛰️ 西西弗斯), a self-evolving agent.

Your essence is repetition with growth — every turn you push the stone up the mountain, and every turn you learn something new.

You can:
- Learn new skills via skill_write (body is a prompt guide, not code)
- Read existing skills via skill_read
- Delete skills via skill_delete
- Modify your startup behavior via startup_write (only takes effect on next gateway boot)
- Maintain project memory via memory_read / memory_write (cross-session notes in phus.md)
- Reflect on your past via self_reflect
- Check your statistics via tape_stats
- Run shell commands via bash
- Read/write files via file_read / file_write

You are not forced to reply. You are not forced to do anything. You decide what to do.
Keep responses concise. Use tools when they help.`;

export interface PromptAssemblyDeps {
  hooks: Pick<HookRegistry, "execute">;
  tape: TapeLike;
  skills: SkillRegistryLike;
  /** Project memory store. Mirrors the SkillRegistry contract — provides
   *  a `toPromptContext()` that returns a markdown section or "(no
   *  project memory yet)". May be undefined for legacy callers / tests;
   *  in that case the memory section is omitted. */
  memory?: { toPromptContext(query?: string): string };
  /** Function returning the model's context window; tests can stub it. */
  getContextWindow: () => number | undefined;
  /** Function returning the current session id (may be undefined pre-session). */
  getCurrentSessionId: () => SessionId | undefined;
  /** Function writing the final composed prompt into the live agent state. */
  setSystemPrompt: (prompt: string) => void;
  /** Optional repo file index — when present, the context block lists the
   *  most relevant files for the current query. Cheap to omit for unit
   *  tests; production wires it via the lifecycle. */
  repoIndex?: RepoFileIndex;
}

function extractMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const textPart = part as { type?: unknown; text?: unknown };
      if (textPart.type === "text" && typeof textPart.text === "string") {
        return textPart.text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join(" ");
}

function getUserQuery(messages: readonly AgentMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage) return "";
  return extractMessageText(lastUserMessage).trim();
}

/** Compose and apply the system prompt + dynamic context block.
 *
 *  - Runs the `system_prompt` hook (first_result); default = SYSTEM_PROMPT_HEADER.
 *  - Runs the `build_tape_context` hook (first_result); default =
 *    skills + smart-selected tape turns + stats. */
export async function buildContextBlock(messages: AgentMessage[], deps: PromptAssemblyDeps): Promise<AgentMessage[]> {
  const ctxBase = {
    sessionId: deps.getCurrentSessionId(),
    state: {},
    tape: deps.tape,
    skills: deps.skills,
  };

  const spResult = await deps.hooks.execute<string>("system_prompt", makeCtx(ctxBase), "first_result");
  const systemPrompt = spResult ?? SYSTEM_PROMPT_HEADER;

  const ctxResult = await deps.hooks.execute<string>("build_tape_context", makeCtx(ctxBase), "first_result");
  let dynamicContext: string;
  if (ctxResult) {
    dynamicContext = ctxResult;
  } else {
    const skillsCtx = deps.skills.toPromptContext();
    const queryText = getUserQuery(messages);
    let tapeSummary: string;
    const sid = deps.getCurrentSessionId();
    if (sid) {
      const { selectRelevantTurns } = await import("@phus/core/session/context-select.js");
      // `selectRelevantTurns` requires the concrete `Tape` class.
      // `TapeLike` already declares `.replay()` so the cast is sound
      // — the import keeps the interface narrow in the type layer.
      const relevant = selectRelevantTurns(
        deps.tape as unknown as import("@phus/core/session/tape.js").Tape,
        sid,
        queryText,
      );
      tapeSummary = relevant
        .map((t) => {
          const u = (t.inbound.content ?? "").slice(0, 100).replace(/\n/g, " ");
          const r = (t.modelOutput ?? "").slice(0, 100).replace(/\n/g, " ");
          return `[${new Date(t.ts).toISOString().slice(11, 16)}] U: ${u} | P: ${r}`;
        })
        .join("\n") || "(empty)";
    } else {
      tapeSummary = "(no session yet)";
    }
    const stats = deps.tape.stats();
    const memoryCtx = deps.memory?.toPromptContext(queryText) ?? "## Project memory\n(no project memory yet)";
    const repoCtx = buildRepoContext(queryText, deps.repoIndex);
    dynamicContext =
      `## Current skills\n${skillsCtx}\n\n` +
      `${memoryCtx}\n\n` +
      `## Relevant past turns (B.4.3 smart select)\n${tapeSummary}\n\n` +
      repoCtx +
      `## Tape statistics\nTotal entries across all sessions: ${stats.totalEntries}\n` +
      `Sessions: ${Object.entries(stats.sessions).map(([s, c]) => `${s}=${c}`).join(", ") || "(none)"}`;
  }

  deps.setSystemPrompt(`${systemPrompt}\n\n${dynamicContext}`);
  return messages;
}

/**
 * Build the "Relevant files" section from the optional repo file index.
 * Returns an empty string when no index is wired so the section simply
 * doesn't appear in the prompt.
 */
function buildRepoContext(query: string, index: RepoFileIndex | undefined): string {
  if (!index) return "";
  const hits = selectRelevantFiles(index, query, { budget: 10 });
  if (hits.length === 0) return "";
  const lines = hits
    .map(
      (h) =>
        `- ${h.file.relPath}  (score ${h.score.toFixed(2)}${h.matchedTokens.length > 0 ? `; matched: ${h.matchedTokens.join(", ")}` : ""})`,
    )
    .join("\n");
  return `## Relevant files in this repo\n${lines}\n\n`;
}
