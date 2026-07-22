// src/channels/whatsapp.ts
// WhatsApp channel placeholder for Phase 3.
//
// A full implementation typically requires `whatsapp-web.js` or
// `baileys`, both of which pull in heavy native dependencies
// (puppeteer / chromium) and are intentionally skipped in this phase.
// TODO: implement a lightweight webhook-based adapter when a stable
//       WhatsApp Business API client is available without puppeteer.

import type { ChannelAdapter, ChannelStatus } from "./base.js";
import type { Outbound } from "@phus/core/types/channel/index.js";
import type { PhusAgent } from "../bridge/pi-agent.js";

export class WhatsAppChannel implements ChannelAdapter {
  readonly name = "whatsapp";

  async listen(_agent: PhusAgent): Promise<void> {
    throw new Error(
      "WhatsApp channel is not yet implemented. Set up a webhook-based adapter or contribute a puppeteer-free implementation.",
    );
  }

  async send(_outbounds: Outbound[]): Promise<void> {
    throw new Error("WhatsApp channel is not yet implemented.");
  }

  status(): ChannelStatus {
    return { name: this.name, listening: false, connected: 0 };
  }
}
