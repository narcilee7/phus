// src/tui/channel.ts
// PhusAgent channel adapter for the TUI.
//
// The TUI is the source of truth for display — agent events stream
// through `subscribeToAgentEvents` and `channel.send()` reconciles the
// final outbound text with the streaming message.

import type { ChannelAdapter } from "@/channels/base.js";
import type { AppAction } from "@/tui/state.js";

export function tuiChannel(
  dispatch: (action: AppAction) => void,
): ChannelAdapter {
  return {
    name: "tui",
    listen() {
      /* no-op — events come via subscribeToAgentEvents */
    },
    async send(outbounds) {
      for (const o of outbounds) {
        if (o.type === "text" && o.content) {
          dispatch({ type: "finalize_streaming" });
          dispatch({ type: "append_delta", delta: o.content });
          dispatch({ type: "finalize_streaming" });
        }
      }
    },
  };
}