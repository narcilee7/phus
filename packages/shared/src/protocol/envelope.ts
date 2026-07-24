/**
 * Channel protocol shapes — Envelope (inbound) and Outbound (sent back).
 *
 * These are the wire-format types that travel between channels and the
 * agent. They live in @phus/shared because:
 *   1. Channels, core, runtime, tui and apps/* all reference them.
 *   2. They have no business logic — just data shapes.
 *   3. Plugins also need them (loaded via @phus/core plugins which
 *      bridge to channels).
 */

import type { SessionId } from "../types/brand.js";

export interface SessionAddress {
  channel: string;
  scope: string;
  conversationKey: string;
  threadKey?: string;
}

export type OutboundType = "text" | "image" | "reaction";

export type EnvelopType = "text" | "image" | "reaction" | "command";

/** A message to send back through a channel. */
export interface Outbound {
	to: string;
	content: string;
	type: OutboundType;
	channel: string;
	replyTo?: string;
	/** Channel-specific extras (threadTs, subject, etc.). */
	metadata?: Record<string, unknown>;
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
	/** Optional target SessionAddress. PhusAgent.turn uses this to look
	 *  up or create a durable Session via SessionStore.resolveOrCreate.
	 *  Routing precedence:
	 *    envelope.sessionId > envelope.address > resolve_session hook
	 *    > legacy `${channel}:${chatId}` fallback. */
	address?: import("./envelope.js").SessionAddress;
	/** Optional channel-native subject id used to resolve a
	 *  cross-channel SessionIdentity. Channels that expose a stable
	 *  user/peer id (telegram, slack, cli, email) populate this. */
	subjectId?: string;
	/** Optional human-readable label for the resolved identity. */
	displayName?: string;
	/** Optional resolved SessionIdentity id, stamped by PhusAgent.turn. */
	identityId?: import("../types/brand.js").SessionId;
	ts: number;
}