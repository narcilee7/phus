// src/channels/telegram.ts
// Placeholder Telegram channel — stub so gateway --telegram can load.
// Real implementation requires `npm install telegraf` (not in base deps).

import type { ChannelAdapter } from "./base.js";
import type { Outbound } from "../core/types.js";

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  constructor(_token: string) {
    console.warn("[phus] TelegramChannel is a stub — install telegraf to enable.");
  }
  async listen(): Promise<void> {
    throw new Error("TelegramChannel not implemented. Install telegraf and replace this stub.");
  }
  async send(_outbounds: Outbound[]): Promise<void> {}
}
