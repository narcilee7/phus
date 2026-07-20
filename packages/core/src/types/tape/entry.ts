import { Envelope } from "../types/channel/index.js";
import { Turn } from "../types/tape/turn.js";
type Plan = any; // plan/types stubbed post Wave G
import type { SessionId, ToolCallId, TurnId } from "../types/brand.js";

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
  | "checkpoint"
  | "memory_write";

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

/** What the agent did to phus.md. `body` is undefined for `delete`. */
export type MemoryWriteAction = {
  kind: "append" | "replace" | "delete";
  section: string;
  body?: string;
};

/** Emitted every time the agent mutates project memory. The `diff` is
 *  a short unified-diff so `phus logs` / self-reflection can replay
 *  the change without re-reading phus.md. `category` and `authority`
 *  are §A Memory OS provenance fields — when present they let
 *  `phus trace` show "who asserted this and how" without re-parsing. */
export type TapeMemoryWriteEntry = {
  kind: "memory_write";
  sessionId: SessionId;
  action: MemoryWriteAction;
  reason: string;
  diff: string;
  autonomyDecision: "auto" | "approve";
  category?: string;
  authority?: string;
  ts: number;
};

export type TapePlanEntry = {
  kind: "plan";
  sessionId: SessionId;
  plan: Plan;
  ts: number;
};

export type TapeEntry =
  | TapeTurnEntry
  | TapeAnchorEntry
  | TapeToolCallEntry
  | TapeToolResultEntry
  | TapeErrorEntry
  | TapeCheckpointEntry
  | TapeMemoryWriteEntry
  | TapePlanEntry;

export type TapeState = Record<string, unknown>;