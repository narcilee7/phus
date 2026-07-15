// src/core/types.ts
// Shared types across Phus core, bridge, and channels.

import type { TSchema } from "typebox";

/** A message inbound from any channel. */
export interface Envelope {
  id: string;
  /** Sender identifier (channel-native, e.g. telegram user id, ws client id). */
  from: string;
  /** Main text content. For images, this is the caption or URL. */
  content: string;
  type: "text" | "image" | "reaction" | "command";
  channel: string;
  /** Channel-specific extras (chatId, userId, isGroup, etc). */
  metadata: Record<string, unknown>;
  /** Optional message id this is replying to. */
  replyTo?: string;
  /** Optional raw image payload (base64) for image type. */
  image?: { data: string; mimeType: string };
  /** Session id (set by resolveSession hook, used downstream). */
  sessionId?: string;
  ts: number;
}

/** A message to send back through a channel. */
export interface Outbound {
  to: string;
  content: string;
  type: "text" | "image" | "reaction";
  channel: string;
  replyTo?: string;
}

/** A complete turn recorded in Tape. */
export interface Turn {
  id: string;
  ts: number;
  sessionId: string;
  inbound: Envelope;
  prompt: string;
  modelOutput: string;
  toolCalls: { name: string; args: unknown; result: unknown; isError?: boolean }[];
  outbound: Outbound[];
  durationMs?: number;
}

/** Per-session state loaded/saved via loadState / saveState hooks. */
export type State = Record<string, unknown>;

/** Skill definition in Agent Skills standard (SKILL.md + frontmatter). */
export interface Skill {
  /** Skill name (must match directory name). */
  name: string;
  /** Short description used in system prompt. */
  description: string;
  /** Skill body — prompt guide the LLM reads, no executable code. */
  body: string;
  /** Absolute path to the skill directory. */
  location: string;
  /** Discovered source: builtin / user / project. */
  source: "builtin" | "user" | "project";
  /** Frontmatter metadata (author, version, etc). */
  metadata: {
    author?: "human" | "ai";
    version?: string;
    [key: string]: unknown;
  };
  createdAt: number;
}

/** A single entry written to Tape. */
export type TapeEntry =
  | { kind: "turn"; turn: Turn }
  | { kind: "anchor"; sessionId: string; name: string; state: State; ts: number }
  | { kind: "tool_call"; sessionId: string; toolCallId: string; name: string; args: unknown; ts: number }
  | { kind: "tool_result"; sessionId: string; toolCallId: string; result: unknown; isError: boolean; ts: number }
  | { kind: "error"; sessionId: string; stage: string; envelope?: Envelope; error: string; ts: number }
  | { kind: "checkpoint"; sessionId: string; turnId?: string; messages: unknown[]; ts: number };

/** Meta Tool definition (Phus-internal tools that let the AI modify itself). */
export interface MetaTool {
  name: string;
  description: string;
  /** TypeBox schema describing the tool's input parameters. */
  parameters: TSchema;
  /** Map from validated args → result. Throwing is treated as failure. */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
