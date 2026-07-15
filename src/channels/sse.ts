// src/channels/sse.ts
// Placeholder SSE channel — stub so gateway --sse can load.

import type { ChannelAdapter } from "./base.js";
import type { Outbound } from "../core/types.js";

export class SSEChannel implements ChannelAdapter {
  readonly name = "sse";
  constructor(_port: number) {
    console.warn("[phus] SSEChannel is a stub.");
  }
  async listen(): Promise<void> {
    throw new Error("SSEChannel not implemented.");
  }
  async send(_outbounds: Outbound[]): Promise<void> {}
}
