// src/tui/channel.ts
// PhusAgent channel adapter for the TUI.
//
// The TUI is the source of truth for display — agent events stream
// through `subscribeToAgentEvents` and `channel.send()` reconciles the
// final outbound text with the streaming message.

import type { ChannelAdapter } from "@phus/runtime/channels/base.js";
import type { AppAction, ChatItem } from "./state/state.js";

export function tuiChannel(
  dispatch: (action: AppAction) => void,
  getState?: () => { items: ChatItem[] },
): ChannelAdapter {
  return {
    name: "tui",
    listen() {
      /* no-op — events come via subscribeToAgentEvents */
    },
    async send(outbounds) {
      for (const o of outbounds) {
        if (o.type !== "text") continue;
        const items = getState?.().items ?? [];
        // Check ONLY items from the current streaming pass — not any
        // historical assistant item. Multi-turn: after turn N there is
        // always an assistant item in state from turn N-1, so the old
        // `items.some(kind === "assistant")` test always matched and
        // the `else if (o.content)` branch was unreachable. That's why
        // rounds where streaming didn't fire (e.g. model produced only
        // tool calls, or the provider yielded zero text deltas) appeared
        // to vanish from the TUI.
        const hasStreaming = items.some(
          (it) => it.kind === "assistant" && it.isStreaming,
        );
        // Streaming already rendered the same text on the last assistant
        // item — don't double-append. Without this check the success
        // path ("model streamed text + we got the final outbound too")
        // renders the assistant reply twice.
        const last = items.length > 0 ? items[items.length - 1] : undefined;
        const alreadyRenderedThisTurn =
          last?.kind === "assistant" &&
          !last.isStreaming &&
          typeof o.content === "string" &&
          last.text === o.content;
        if (!hasStreaming && !alreadyRenderedThisTurn && o.content) {
          // No streaming happened for this turn (short-circuit path): add
          // the final text. After turn 1 the assistant item from the
          // previous turn is no longer marked streaming, so this branch
          // is correctly reachable again from turn 2 onwards.
          dispatch({ type: "append_delta", delta: o.content });
        }
        // Always clear any stale streaming flag — covers both the
        // streaming case (the just-finished turn) and the short-circuit
        // case (some prior item left dangling).
        dispatch({ type: "finalize_streaming" });
      }
    },
  };
}
