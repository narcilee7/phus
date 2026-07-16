// src/channels/base.ts
// ChannelAdapter contract — every channel (CLI / Telegram / WebSocket / SSE)
// implements this so PhusAgent can talk to them uniformly.

import type { Envelope, Outbound } from "@/types/channel/index.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";

/** Snapshot returned by {@link ChannelAdapter.status} for diagnostics. */
export interface ChannelStatus {
  /** Human-readable channel name. */
  name: string;
  /** Whether the listener is currently active. */
  listening: boolean;
  /** Number of active connections / sessions. */
  connected: number;
  /** Channel-specific extras (port, url, etc.). */
  details?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly name: string;
  /** Start listening for inbound messages; forward them to the agent. */
  listen(agent: PhusAgent): void | Promise<void>;
  /** Send one or more outbound messages through this channel. */
  send(outbounds: Outbound[]): Promise<void>;
  /** Optional clean shutdown. */
  close?(): void | Promise<void>;
  /** Optional diagnostic snapshot (used by gateway health/status). */
  status?(): ChannelStatus | Promise<ChannelStatus>;
}

/** Build a minimal text Envelope. Channel-specific adapters wrap this. */
export function makeTextEnvelope(opts: {
  from: string;
  content: string;
  channel: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  id?: string;
}): Envelope {
  return {
    id: opts.id ?? crypto.randomUUID(),
    from: opts.from,
    content: opts.content,
    type: "text",
    channel: opts.channel,
    metadata: opts.metadata ?? {},
    replyTo: opts.replyTo,
    ts: Date.now(),
  };
}

/** Convenience builder for a text envelope tied to a chat/session. */
export function makeEnvelopeFromChat(opts: {
  channel: string;
  chatId: string;
  content: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}): Envelope {
  return makeTextEnvelope({
    channel: opts.channel,
    from: opts.from ?? opts.chatId,
    content: opts.content,
    replyTo: opts.replyTo,
    metadata: {
      chatId: opts.chatId,
      ...opts.metadata,
    },
  });
}
