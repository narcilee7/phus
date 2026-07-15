import { Envelope } from "@/types/channel/index.js";
import { Turn } from "@/types/tape/turn.js";
import type { SessionId, ToolCallId, TurnId } from "@/types/brand.js";

/**
 * Discriminant for `TapeEntry`. String-literal union so that runtime
 * values (SQLite JSON payloads, hooks writing `kind: "turn"`) match the
 * type without needing an enum import.
 */
export type TapeEntryKind =
  | "turn"
  | "anchor"
  | "tool_call"
  | "tool_result"
  | "error"
  | "checkpoint";

export type TapeTurnEntry = {
  kind: "turn";
  turn: Turn;
};

export type TapeAnchorEntry = {
  kind: "anchor";
  sessionId: SessionId;
  name: string;
  state: Record<string, unknown>;
  args: unknown;
  ts: number;
};

export type TapeToolCallEntry = {
  kind: "tool_call";
  sessionId: SessionId;
  toolCallId: ToolCallId;
  name: string;
  args: unknown;
  ts: number;
};

export type TapeToolResultEntry = {
  kind: "tool_result";
  sessionId: SessionId;
  toolCallId: ToolCallId;
  result: unknown;
  isError: boolean;
  ts: number;
};

export type TapeErrorEntry = {
  kind: "error";
  sessionId: SessionId;
  stage: string;
  error: string;
  ts: number;
  envelope?: Envelope;
};

export type TapeCheckpointEntry = {
  kind: "checkpoint";
  sessionId: SessionId;
  messages: unknown[];
  ts: number;
  turnId?: TurnId;
};

export type TapeEntry =
  | TapeTurnEntry
  | TapeAnchorEntry
  | TapeToolCallEntry
  | TapeToolResultEntry
  | TapeErrorEntry
  | TapeCheckpointEntry;

export type TapeState = Record<string, unknown>;