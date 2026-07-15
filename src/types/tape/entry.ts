import { Envelope } from "@/types/channel/index.js";
import { Turn } from "@/types/tape/turn.js";

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
  sessionId: string;
  name: string;
  state: Record<string, unknown>;
  args: unknown;
  ts: number;
};

export type TapeToolCallEntry = {
  kind: "tool_call";
  sessionId: string;
  toolCallId: string;
  name: string;
  args: unknown;
  ts: number;
};

export type TapeToolResultEntry = {
  kind: "tool_result";
  sessionId: string;
  toolCallId: string;
  result: unknown;
  isError: boolean;
  ts: number;
};

export type TapeErrorEntry = {
  kind: "error";
  sessionId: string;
  stage: string;
  error: string;
  ts: number;
  envelope?: Envelope;
};

export type TapeCheckpointEntry = {
  kind: "checkpoint";
  sessionId: string;
  messages: unknown[];
  ts: number;
  turnId?: string;
};

export type TapeEntry =
  | TapeTurnEntry
  | TapeAnchorEntry
  | TapeToolCallEntry
  | TapeToolResultEntry
  | TapeErrorEntry
  | TapeCheckpointEntry;

export type TapeState = Record<string, unknown>;