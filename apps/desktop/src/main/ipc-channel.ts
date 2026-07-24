import type { ChannelAdapter } from "@phus/runtime/channels/base.js";
import type { Outbound } from "@phus/shared/protocol/envelope.js";
import { BrowserWindow } from "electron";
import type { AgentMessageChunk } from "./event-mapper.js";

/**
 * Channel adapter that forwards outbound agent messages to the focused
 * renderer window via IPC.
 */
export function createIpcChannel(win: BrowserWindow): ChannelAdapter {
  return {
    name: "desktop_ipc",
    listen() {
      // no-op — inbound messages arrive through ipcMain instead
    },
    async send(outbounds: Outbound[]) {
      for (const o of outbounds) {
        if (o.type !== "text") continue;
        const chunk: AgentMessageChunk = {
          type: "text",
          content: o.content,
        };
        if (!win.isDestroyed()) {
          win.webContents.send("phus:message", chunk);
        }
      }
    },
  };
}
