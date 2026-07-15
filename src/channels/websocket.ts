// src/channels/websocket.ts
// Placeholder WebSocket channel — stub so gateway --websocket can load.
// Real implementation requires `npm install ws`.

import type { ChannelAdapter } from "@/channels/base.js";
import type { Outbound } from "@/types/channel/index.js";
import { logger } from "@/core/runtime/logger.js";

export class WebSocketChannel implements ChannelAdapter {
  readonly name = "websocket";
  constructor(_port: number) {
    logger.warn("channel.stub", { channel: "websocket" });
  }
  async listen(): Promise<void> {
    throw new Error("WebSocketChannel not implemented. Install ws and replace this stub.");
  }
  async send(_outbounds: Outbound[]): Promise<void> {}
}
