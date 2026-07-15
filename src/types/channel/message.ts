/**
 * channel message's definition
 */

import type { SessionId } from "@/types/brand.js";

export type OutboundType = "text" | "image" | "reaction";

export type EnvelopType = "text" | "image" | "reaction" | "command";

/** A message to send back through a channel. */
export interface Outbound {
  to: string;
  content: string;
  type: OutboundType;
  channel: string;
  replyTo?: string;
}

/** A message inbound from any channel. */
export interface Envelope {
  id: string;
  /** Sender identifier (channel-native, e.g. telegram user id, ws client id). */
  from: string;
  /** Main text content. For images, this is the caption or URL. */
  content: string;
  type: EnvelopType;
  channel: string;
  /** Channel-specific extras (chatId, userId, isGroup, etc). */
  metadata: Record<string, unknown>;
  /** Optional message id this is replying to. */
  replyTo?: string;
  /** Optional raw image payload (base64) for image type. */
  image?: { data: string; mimeType: string };
  /** Session id (set by resolve_session hook, used downstream).
   *  Optional because envelopes arrive before session resolution. */
  sessionId?: SessionId;
  ts: number;
}
