import type { SessionId } from "../brand.js";

export type SessionKind = "conversation" | "scheduled" | "subagent" | "system";

export type SessionStatus = "open" | "closed" | "archived";

export interface SessionAddress {
  channel: string;
  scope: string;
  conversationKey: string;
  threadKey?: string;
}

export interface SessionOrigin {
  channel: string;
  scope: string;
  conversationKey: string;
  threadKey?: string;
}

export interface Session {
  id: SessionId;
  kind: SessionKind;
  status: SessionStatus;
  origin: SessionOrigin;
  parentSessionId?: SessionId;
  title?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  identityId?: SessionId;
  createdAt: number;
  updatedAt: number;
  lastTurnAt?: number;
}

export interface CreateSessionOptions {
  address: SessionAddress;
  id?: SessionId;
  kind?: SessionKind;
  status?: SessionStatus;
  parentSessionId?: SessionId;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  lastTurnAt?: number;
}

export interface SessionFilter {
  status?: SessionStatus | readonly SessionStatus[];
  kind?: SessionKind;
  parentSessionId?: SessionId;
  includeArchived?: boolean;
}
