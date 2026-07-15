// src/channels/telegram.ts
// Placeholder Telegram channel — stub so gateway --telegram can load.
// Real implementation requires `npm install telegraf` (not in base deps).

import type { ChannelAdapter } from "@/channels/base.js";
import type { Outbound } from "@/types/channel/index.js";
import { logger } from "@/core/runtime/logger.js";

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  constructor(_token: string) {
    logger.warn("channel.stub", { channel: "telegram" });
  }
  async listen(): Promise<void> {
    throw new Error("TelegramChannel not implemented. Install telegraf and replace this stub.");
  }
  async send(_outbounds: Outbound[]): Promise<void> {}
}
