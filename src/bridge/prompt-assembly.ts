// src/bridge/prompt-assembly.ts
// System prompt + context injection. Runs on every LLM call via Pi's
// `transformContext` callback.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SkillRegistryLike, TapeLike } from "@/types/hooks/index.js";
import type { SessionId } from "@/types/brand.js";
import { makeCtx } from "@/core/hook.js";
import type { HookRegistry } from "@/core/hook.js";

export const SYSTEM_PROMPT_HEADER = `You are Phus (⛰️ 西西弗斯), a self-evolving agent.

Your essence is repetition with growth — every turn you push the stone up the mountain, and every turn you learn something new.

You can:
- Learn new skills via skill_write (body is a prompt guide, not code)
- Read existing skills via skill_read
- Delete skills via skill_delete
- Modify your startup behavior via startup_write (only takes effect on next gateway boot)
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
  /** Function returning the model's context window; tests can stub it. */
  getContextWindow: () => number | undefined;
  /** Function returning the current session id (may be undefined pre-session). */
  getCurrentSessionId: () => SessionId | undefined;
  /** Function returning the messages so we can pick the last user message
   *  as the relevance-query input for `selectRelevantTurns`. */
  getMessages: () => readonly AgentMessage[];
  /** Function writing the final composed prompt into the live agent state. */
  setSystemPrompt: (prompt: string) => void;
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
    let tapeSummary: string;
    const sid = deps.getCurrentSessionId();
    if (sid) {
      const lastUserMsg = [...deps.getMessages()].reverse().find((m) => m.role === "user");
      const query = (lastUserMsg as any)?.content ?? "";
      const queryText = typeof query === "string"
        ? query
        : Array.isArray(query)
          ? query.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ")
          : "";
      const { selectRelevantTurns } = await import("@/core/context-select.js");
      // `selectRelevantTurns` requires the concrete `Tape` class.
      // `TapeLike` already declares `.replay()` so the cast is sound
      // — the import keeps the interface narrow in the type layer.
      const relevant = selectRelevantTurns(
        deps.tape as unknown as import("@/core/tape.js").Tape,
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
    dynamicContext =
      `## Current skills\n${skillsCtx}\n\n` +
      `## Relevant past turns (B.4.3 smart select)\n${tapeSummary}\n\n` +
      `## Tape statistics\nTotal entries across all sessions: ${stats.totalEntries}\n` +
      `Sessions: ${Object.entries(stats.sessions).map(([s, c]) => `${s}=${c}`).join(", ") || "(none)"}`;
  }

  deps.setSystemPrompt(`${systemPrompt}\n\n${dynamicContext}`);
  return messages;
}