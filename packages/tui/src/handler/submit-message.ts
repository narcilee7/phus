// src/tui/handler/submit-message.ts
// Push a user message through the agent. Reads file mentions out of
// @-references, prepends them as a context block, and dispatches the
// whole bundle through the TUI channel adapter.

import { randomUUID } from "node:crypto";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import type { AppAction, AppState } from "@/state/state.js";
import type { ChannelAdapter } from "@phus/runtime/channels/base.js";
import {
  buildContextBlock,
  extractMentions,
  readFileMention,
  type FileContext,
} from "@/handler/mentions/mentions.js";
import { runSlash, type SlashResult } from "@/handler/commands/commands.js";

export interface SubmitContext {
  agent: PhusAgent;
  state: AppState;
  dispatch: (action: AppAction) => void;
  setInput: (updater: (prev: string) => string) => void;
  /** Adapter factory — called per-turn with both the dispatch and a live
   *  reader so the channel can reconcile its final send against the
   *  items the streaming events already produced. */
  channel: (
    dispatch: (action: AppAction) => void,
    getItems: () => AppState["items"],
  ) => ChannelAdapter;
  /** Live reader — passed back into the channel factory above. */
  getItems: () => AppState["items"];
  clearChat: () => void;
}

/** Top-level submit entry: slash command short-circuit, otherwise hand
 *  the message to the agent. Returns "quit" / "clear" so the caller can
 *  propagate exit / wipe signals. */
export async function submitMessage(text: string, ctx: SubmitContext): Promise<SlashResult> {
  if (!text.trim() || ctx.state.busy) return;
  ctx.setInput(() => "");
  ctx.dispatch({ type: "hide_hint" });

  if (text.startsWith("/") || text.startsWith(",")) {
    const result = await runSlash(text, ctx.agent, ctx.state, ctx.dispatch);
    if (result === "clear") ctx.clearChat();
    return result;
  }

  ctx.dispatch({ type: "scroll_bottom" });
  ctx.dispatch({ type: "set_busy", busy: true });
  ctx.dispatch({ type: "set_last_op", op: "thinking…" });
  ctx.dispatch({ type: "add_user", text });

  const content = await expandFileMentions(text, ctx);

  try {
    await ctx.agent.turn(
      {
        id: randomUUID(),
        from: "user",
        content,
        type: "text",
        channel: "tui",
        metadata: { chatId: "tui" },
        ts: Date.now(),
      },
      ctx.channel(ctx.dispatch, ctx.getItems),
    );
  } catch (err) {
    ctx.dispatch({
      type: "add_system",
      text: `error: ${err instanceof Error ? err.message : String(err)}`,
      level: "error",
    });
  } finally {
    ctx.dispatch({ type: "set_busy", busy: false });
    ctx.dispatch({ type: "set_last_op", op: "idle" });
  }
}

/** Read every `@path` mention, build the context block, and merge it
 *  with the original user text. Failures are surfaced as system warns
 *  so the user can see which mention broke. */
async function expandFileMentions(text: string, ctx: SubmitContext): Promise<string> {
  const mentions = extractMentions(text).filter((m) => m.type === "file");
  if (mentions.length === 0) return text;

  const fileContexts: FileContext[] = [];
  for (const mention of mentions) {
    try {
      const file = await readFileMention(mention.target);
      fileContexts.push(file);
    } catch (err) {
      ctx.dispatch({
        type: "add_system",
        text: `could not read ${mention.target}: ${err instanceof Error ? err.message : String(err)}`,
        level: "warn",
      });
    }
  }
  const block = buildContextBlock(fileContexts);
  return block ? `${block}\n\n${text}` : text;
}
