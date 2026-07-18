// src/tui/channel.ts
// PhusAgent channel adapter for the TUI.
//
// The TUI is the source of truth for display — agent events stream
// through `subscribeToAgentEvents` and `channel.send()` reconciles the
// final outbound text with the streaming message.

import type { ChannelAdapter } from "@phus/runtime/channels/base.js";
import type { AppAction } from "@/state/state.js";

export function tuiChannel(
  dispatch: (action: AppAction) => void,
  getState?: () => { items: { kind: string; isStreaming?: boolean }[] },
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
        const hasAssistant = items.some((it) => it.kind === "assistant");
        if (hasAssistant) {
          // Streaming deltas (or a previous finalize) already rendered the text;
          // just make sure the assistant item is no longer marked streaming.
          dispatch({ type: "finalize_streaming" });
        } else if (o.content) {
          // No streaming happened (e.g. short-circuit path): add the final text.
          dispatch({ type: "append_delta", delta: o.content });
          dispatch({ type: "finalize_streaming" });
        }
      }
    },
  };
}
