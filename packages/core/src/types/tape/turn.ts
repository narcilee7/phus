/**
 * Tape Turn
 */

import { Envelope, Outbound } from "../../types/channel/index.js";
import type { SessionId, TurnId } from "../../types/brand.js";

/**
 * Phus-side view of a tool invocation recorded against a turn.
 *
 * Distinct from `@mariozechner/pi-ai`'s `ToolCall` because Pi's tool
 * calls don't carry a result or error flag — that's added when we
 * project a turn into the Tape log.
 */
export interface TapeToolCall {
  name: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
}

/** A complete run recorded in Tape. */
export interface Turn {
  id: TurnId;
  ts: number;
  sessionId: SessionId;
  inbound: Envelope;
  prompt: string;
  modelOutput: string;
  toolCalls: TapeToolCall[];
  outbound: Outbound[];
  durationMs?: number;
}