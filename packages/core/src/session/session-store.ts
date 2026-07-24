import { randomUUID } from "node:crypto";
import type { SessionId } from "../types/brand.js";
import { asSessionId } from "../types/brand.js";
import type {
  CreateSessionOptions,
  Session,
  SessionAddress,
  SessionFilter,
  SessionKind,
  SessionStatus,
} from "../types/session/index.js";
import { SessionStorage } from "./session-storage.js";

const SESSION_KINDS: readonly SessionKind[] = [
  "conversation",
  "scheduled",
  "subagent",
  "system",
];
const SESSION_STATUSES: readonly SessionStatus[] = ["open", "closed", "archived"];
const LEGACY_CHANNELS = new Set([
  "cli",
  "tui",
  "telegram",
  "slack",
  "websocket",
  "sse",
  "email",
  "whatsapp",
]);

interface SessionRow {
  id: string;
  kind: string;
  status: string;
  origin_channel: string;
  origin_scope: string;
  conversation_key: string;
  thread_key: string;
  parent_session_id: string | null;
  title: string | null;
  tags: string;
  metadata: string;
  identity_id: string | null;
  created_at: number;
  updated_at: number;
  last_turn_at: number | null;
}

interface LegacyTapeRow {
  session_id: string;
  min_ts: number;
  max_ts: number;
  last_turn_ts: number | null;
}

export interface SessionBootstrapResult {
  created: number;
  skipped: number;
}

export class SessionStore {
  private readonly storage: SessionStorage;
  private readonly ownsStorage: boolean;

  constructor(input: string | SessionStorage) {
    this.ownsStorage = typeof input === "string";
    this.storage = typeof input === "string" ? new SessionStorage(input) : input;
    this.init();
  }

  create(options: CreateSessionOptions): Session {
    const kind = options.kind ?? "conversation";
    const status = options.status ?? "open";
    assertSessionKind(kind);
    assertSessionStatus(status);

    const createdAt = options.createdAt ?? Date.now();
    const updatedAt = options.updatedAt ?? createdAt;
    if (options.id !== undefined && options.id.length === 0) {
      throw new Error("session id cannot be empty");
    }
    const id = options.id ?? asSessionId(randomUUID());
    const threadKey = normalizeThreadKey(options.address.threadKey);

    this.storage.prepare<[
      string,
      SessionKind,
      SessionStatus,
      string,
      string,
      string,
      string,
      string | null,
      string | null,
      string,
      string,
      number,
      number,
      number | null,
    ]>(`
      INSERT INTO sessions (
        id, kind, status, origin_channel, origin_scope, conversation_key,
        thread_key, parent_session_id, title, tags, metadata,
        created_at, updated_at, last_turn_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      kind,
      status,
      options.address.channel,
      options.address.scope,
      options.address.conversationKey,
      threadKey,
      options.parentSessionId ?? null,
      options.title ?? null,
      JSON.stringify(options.tags ?? []),
      JSON.stringify(options.metadata ?? {}),
      createdAt,
      updatedAt,
      options.lastTurnAt ?? null,
    );

    return this.get(id)!;
  }

  get(id: SessionId): Session | undefined {
    const row = this.storage.prepare<[string], SessionRow>(
      "SELECT * FROM sessions WHERE id = ?",
    ).get(id);
    return row ? rowToSession(row) : undefined;
  }

  ensure(id: SessionId): Session {
    const existing = this.get(id);
    if (existing) return existing;

    const legacy = legacySession(id);
    try {
      return this.create({
        id,
        kind: legacy.kind,
        address: legacy.address,
        metadata: { legacyId: id, source: "runtime-compat" },
      });
    } catch {
      // A concurrent writer may have created this id, or an imported
      // address may already belong to another preserved legacy id.
      const concurrent = this.get(id);
      if (concurrent) return concurrent;
      try {
        return this.create({
          id,
          kind: legacy.kind,
          address: {
            channel: "legacy",
            scope: `runtime-compat:${id}`,
            conversationKey: id,
          },
          metadata: { legacyId: id, source: "runtime-compat" },
        });
      } catch (fallbackError) {
        const raced = this.get(id);
        if (raced) return raced;
        throw fallbackError;
      }
    }
  }

  findByAddress(address: SessionAddress): Session | undefined {
    const row = this.storage.prepare<[string, string, string, string], SessionRow>(`
      SELECT * FROM sessions
      WHERE origin_channel = ? AND origin_scope = ?
        AND conversation_key = ? AND thread_key = ?
    `).get(
      address.channel,
      address.scope,
      address.conversationKey,
      normalizeThreadKey(address.threadKey),
    );
    return row ? rowToSession(row) : undefined;
  }

  resolveOrCreate(
    address: SessionAddress,
    options: Omit<CreateSessionOptions, "address"> = {},
  ): Session {
    const existing = this.findByAddress(address);
    if (existing) return existing;
    try {
      return this.create({ ...options, address });
    } catch (error) {
      // Another process may have inserted the same unique address after
      // our lookup. Return that row when present; otherwise preserve the
      // original creation error (invalid JSON, duplicate id, etc.).
      const concurrent = this.findByAddress(address);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  list(filter: SessionFilter = {}): Session[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const statuses = filter.status
      ? Array.isArray(filter.status) ? filter.status : [filter.status]
      : undefined;

    if (statuses) {
      if (statuses.length === 0) return [];
      for (const status of statuses) assertSessionStatus(status);
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    } else if (!filter.includeArchived) {
      conditions.push("status != 'archived'");
    }
    if (filter.kind) {
      assertSessionKind(filter.kind);
      conditions.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.parentSessionId) {
      conditions.push("parent_session_id = ?");
      params.push(filter.parentSessionId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.storage.prepare<unknown[], SessionRow>(
      `SELECT * FROM sessions ${where} ORDER BY updated_at DESC, id ASC`,
    ).all(...params) as SessionRow[];
    return rows.map(rowToSession);
  }

  recordTurn(
    id: SessionId,
    occurredAt: number,
    recordedAt: number = Date.now(),
  ): void {
    const result = this.storage.prepare<[
      number,
      number,
      number,
      number,
      SessionId,
    ]>(`
      UPDATE sessions
      SET last_turn_at = CASE
            WHEN last_turn_at IS NULL OR last_turn_at < ? THEN ?
            ELSE last_turn_at
          END,
          updated_at = CASE
            WHEN updated_at < ? THEN ?
            ELSE updated_at
          END
      WHERE id = ?
    `).run(occurredAt, occurredAt, recordedAt, recordedAt, id);
    if (result.changes === 0) throw new Error(`session not found: ${id}`);
  }

  close(id: SessionId): Session {
    return this.updateStatus(id, "closed");
  }

  stampIdentity(id: SessionId, identityId: SessionId | null): Session {
    const now = Date.now();
    this.storage.prepare<[string, number, string]>(`
      UPDATE sessions SET identity_id = ?, updated_at = ? WHERE id = ?
    `).run(identityId as string, now, id);
    return this.get(id)!;
  }

  findByIdentity(identityId: SessionId): Session[] {
    return this.list({}).filter((s) => s.identityId === identityId);
  }

  reopen(id: SessionId): Session {
    return this.updateStatus(id, "open");
  }

  archive(id: SessionId): Session {
    return this.updateStatus(id, "archived");
  }

  bootstrapFromTape(): SessionBootstrapResult {
    const tapeTable = this.storage.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tape'",
    ).get();
    if (!tapeTable) return { created: 0, skipped: 0 };

    return this.storage.transaction(() => {
      const rows = this.storage.prepare<[], LegacyTapeRow>(`
        SELECT
          session_id,
          MIN(ts) AS min_ts,
          MAX(ts) AS max_ts,
          MAX(CASE WHEN kind = 'turn' THEN ts END) AS last_turn_ts
        FROM tape
        GROUP BY session_id
        ORDER BY session_id ASC
      `).all();
      const insert = this.storage.prepare<[
        string,
        SessionKind,
        SessionStatus,
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        string,
        string,
        number,
        number,
        number | null,
      ]>(`
        INSERT INTO sessions (
          id, kind, status, origin_channel, origin_scope, conversation_key,
          thread_key, parent_session_id, title, tags, metadata,
          created_at, updated_at, last_turn_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `);

      let created = 0;
      for (const row of rows) {
        const legacy = legacySession(row.session_id);
        const result = insert.run(
          row.session_id,
          legacy.kind,
          "open",
          legacy.address.channel,
          legacy.address.scope,
          legacy.address.conversationKey,
          normalizeThreadKey(legacy.address.threadKey),
          null,
          null,
          "[]",
          JSON.stringify({ legacyId: row.session_id }),
          row.min_ts,
          row.max_ts,
          row.last_turn_ts,
        );
        created += result.changes;
      }

      return { created, skipped: rows.length - created };
    });
  }

  dispose(): void {
    if (this.ownsStorage) this.storage.close();
  }

  private init(): void {
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                TEXT PRIMARY KEY,
        kind              TEXT NOT NULL,
        status            TEXT NOT NULL,
        origin_channel    TEXT NOT NULL,
        origin_scope      TEXT NOT NULL,
        conversation_key  TEXT NOT NULL,
        thread_key        TEXT NOT NULL DEFAULT '',
        parent_session_id TEXT,
        title             TEXT,
        tags              TEXT NOT NULL DEFAULT '[]',
        metadata          TEXT NOT NULL DEFAULT '{}',
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        last_turn_at      INTEGER
      );
    `);
    this.ensureIdentityColumn();
    this.storage.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_address
        ON sessions(origin_channel, origin_scope, conversation_key, thread_key);
      CREATE INDEX IF NOT EXISTS idx_sessions_status_updated
        ON sessions(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_parent
        ON sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_identity
        ON sessions(identity_id);
    `);
  }

  private ensureIdentityColumn(): void {
    const cols = this.storage.prepare<[], { name: string }>(
      "PRAGMA table_info(sessions)",
    ).all();
    if (cols.some((c) => c.name === "identity_id")) return;
    this.storage.exec("ALTER TABLE sessions ADD COLUMN identity_id TEXT");
  }

  private updateStatus(id: SessionId, status: SessionStatus): Session {
    const result = this.storage.prepare<[SessionStatus, number, string]>(
      "UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
    ).run(status, Date.now(), id);
    if (result.changes === 0) throw new Error(`session not found: ${id}`);
    return this.get(id)!;
  }
}

function normalizeThreadKey(threadKey: string | undefined): string {
  return threadKey ?? "";
}

function rowToSession(row: SessionRow): Session {
  assertSessionKind(row.kind);
  assertSessionStatus(row.status);
  return {
    id: asSessionId(row.id),
    kind: row.kind,
    status: row.status,
    origin: {
      channel: row.origin_channel,
      scope: row.origin_scope,
      conversationKey: row.conversation_key,
      threadKey: row.thread_key || undefined,
    },
    parentSessionId: row.parent_session_id
      ? asSessionId(row.parent_session_id)
      : undefined,
    title: row.title ?? undefined,
    tags: parseTags(row.tags),
    metadata: parseMetadata(row.metadata),
    identityId: row.identity_id ? asSessionId(row.identity_id) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTurnAt: row.last_turn_at ?? undefined,
  };
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : [];
  } catch {
    return [];
  }
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function legacySession(sessionId: string): {
  kind: SessionKind;
  address: SessionAddress;
} {
  if (sessionId === "_system") {
    return {
      kind: "system",
      address: {
        channel: "system",
        scope: "legacy",
        conversationKey: "_system",
      },
    };
  }

  const firstColon = sessionId.indexOf(":");
  if (
    firstColon > 0
    && firstColon === sessionId.lastIndexOf(":")
    && firstColon < sessionId.length - 1
  ) {
    const channel = sessionId.slice(0, firstColon);
    if (LEGACY_CHANNELS.has(channel)) {
      return {
        kind: "conversation",
        address: {
          channel,
          scope: "legacy",
          conversationKey: sessionId.slice(firstColon + 1),
        },
      };
    }
  }

  return {
    kind: "conversation",
    address: {
      channel: "legacy",
      scope: "legacy",
      conversationKey: sessionId,
    },
  };
}

function assertSessionKind(value: string): asserts value is SessionKind {
  if (!(SESSION_KINDS as readonly string[]).includes(value)) {
    throw new Error(`invalid session kind: ${value}`);
  }
}

function assertSessionStatus(value: string): asserts value is SessionStatus {
  if (!(SESSION_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`invalid session status: ${value}`);
  }
}
