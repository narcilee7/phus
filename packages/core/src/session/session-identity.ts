import { randomUUID } from "node:crypto";
import { asSessionId, type SessionId } from "../types/brand.js";
import { SessionStorage } from "./session-storage.js";

export interface IdentitySubject {
  channel: string;
  subjectId: string;
  linkedAt: number;
}

export interface SessionIdentity {
  id: SessionId;
  primaryChannel: string;
  primarySubjectId: string;
  displayName?: string;
  subjects: IdentitySubject[];
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
}

interface IdentityRow {
  id: string;
  primary_channel: string;
  primary_subject: string;
  display_name: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
}

interface SubjectRow {
  identity_id: string;
  channel: string;
  subject_id: string;
  linked_at: number;
}

export class IdentityMergeConflictError extends Error {
  constructor(public identityId: string, public channel: string, public subjectId: string) {
    super(
      `subject ${channel}:${subjectId} already linked to a different identity`,
    );
    this.name = "IdentityMergeConflictError";
  }
}

/** Cross-channel human identity catalog. Shares the existing
 *  SessionStorage so it does not open a second SQLite connection. */
export class SessionIdentityStore {
  private readonly storage: SessionStorage;
  private readonly ownsStorage: boolean;
  private closed = false;

  constructor(input: string | SessionStorage) {
    this.ownsStorage = typeof input === "string";
    this.storage = typeof input === "string" ? new SessionStorage(input) : input;
    this.init();
  }

  get(id: SessionId): SessionIdentity | undefined {
    this.assertOpen();
    const row = this.storage.prepare<[string], IdentityRow>(
      "SELECT * FROM session_identities WHERE id = ?",
    ).get(id);
    if (!row) return undefined;
    return rowToIdentity(row, this.subjectsFor(id));
  }

  findBySubject(channel: string, subjectId: string): SessionIdentity | undefined {
    this.assertOpen();
    const row = this.storage.prepare<[string, string], { identity_id: string }>(
      "SELECT identity_id FROM session_identity_subjects WHERE channel = ? AND subject_id = ?",
    ).get(channel, subjectId);
    if (!row) return undefined;
    return this.get(asSessionId(row.identity_id));
  }

  /** Idempotent: returns the existing identity bound to (channel,
   *  subjectId), or creates a new one. */
  getOrCreateBySubject(
    channel: string,
    subjectId: string,
    displayName?: string,
  ): SessionIdentity {
    this.assertOpen();
    const existing = this.findBySubject(channel, subjectId);
    if (existing) {
      if (displayName && displayName !== existing.displayName) {
        this.touchDisplayName(existing.id, displayName);
        return this.get(existing.id)!;
      }
      this.touchLastSeen(existing.id);
      return existing;
    }
    return this.create(channel, subjectId, displayName);
  }

  linkSubject(identityId: SessionId, channel: string, subjectId: string): SessionIdentity {
    this.assertOpen();
    const existing = this.findBySubject(channel, subjectId);
    if (existing) {
      if (existing.id === identityId) {
        this.touchLastSeen(identityId);
        return existing;
      }
      throw new IdentityMergeConflictError(identityId, channel, subjectId);
    }
    this.storage.prepare<[string, string, string, number]>(`
      INSERT OR IGNORE INTO session_identity_subjects
        (identity_id, channel, subject_id, linked_at)
      VALUES (?, ?, ?, ?)
    `).run(identityId, channel, subjectId, Date.now());
    this.touchLastSeen(identityId);
    return this.get(identityId)!;
  }

  unlinkSubject(identityId: SessionId, channel: string, subjectId: string): SessionIdentity {
    this.assertOpen();
    const before = this.get(identityId);
    if (!before) {
      throw new Error(`identity not found: ${identityId}`);
    }
    const remaining = before.subjects.filter((s) => !(s.channel === channel && s.subjectId === subjectId));
    if (remaining.length === before.subjects.length) {
      return before; // nothing to do
    }
    if (remaining.length === 0) {
      throw new IdentityMergeConflictError(
        identityId,
        channel,
        subjectId,
      );
    }
    this.storage.transaction(() => {
      this.storage.prepare<[string, string, string]>(`
        DELETE FROM session_identity_subjects
        WHERE identity_id = ? AND channel = ? AND subject_id = ?
      `).run(identityId, channel, subjectId);
    });
    return this.get(identityId)!;
  }

  merge(sourceId: SessionId, targetId: SessionId): SessionIdentity {
    this.assertOpen();
    if (sourceId === targetId) {
      throw new Error("cannot merge an identity into itself");
    }
    const source = this.get(sourceId);
    const target = this.get(targetId);
    if (!source) throw new Error(`source identity not found: ${sourceId}`);
    if (!target) throw new Error(`target identity not found: ${targetId}`);
    if (source.subjects.length === 0) {
      throw new IdentityMergeConflictError(sourceId, source.primaryChannel, source.primarySubjectId);
    }
    const now = Date.now();
    this.storage.transaction(() => {
      for (const subject of source.subjects) {
        this.storage.prepare<[string, string, string, number, string, string, string]>(`
          INSERT OR IGNORE INTO session_identity_subjects
            (identity_id, channel, subject_id, linked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(targetId, subject.channel, subject.subjectId, subject.linkedAt, targetId, subject.channel, subject.subjectId);
      }
      this.storage.prepare<[string, string]>(`
        UPDATE sessions SET identity_id = ? WHERE identity_id = ?
      `).run(targetId, sourceId);
      this.storage.prepare<[string]>(`
        DELETE FROM session_identity_subjects WHERE identity_id = ?
      `).run(sourceId);
      this.storage.prepare<[string]>(`
        DELETE FROM session_identities WHERE id = ?
      `).run(sourceId);
      this.touchLastSeen(targetId);
    });
    void now;
    return this.get(targetId)!;
  }

  rename(id: SessionId, displayName: string): SessionIdentity {
    this.assertOpen();
    this.storage.prepare<[string, number, string]>(`
      UPDATE session_identities
      SET display_name = ?, updated_at = ?
      WHERE id = ?
    `).run(displayName, Date.now(), id);
    return this.get(id)!;
  }

  list(): SessionIdentity[] {
    this.assertOpen();
    const rows = this.storage.prepare<[], IdentityRow>(
      "SELECT * FROM session_identities ORDER BY created_at ASC",
    ).all();
    return rows.map((row) => rowToIdentity(row, this.subjectsFor(asSessionId(row.id))));
  }

  dispose(): void {
    if (this.ownsStorage && !this.closed) this.storage.close();
    this.closed = true;
  }

  private create(channel: string, subjectId: string, displayName?: string): SessionIdentity {
    const now = Date.now();
    const id = asSessionId(randomUUID());
    try {
      this.storage.transaction(() => {
        this.storage.prepare<[string, string, string, string | null, number, number]>(`
          INSERT INTO session_identities (
            id, primary_channel, primary_subject, display_name, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, channel, subjectId, displayName ?? null, now, now);
        this.storage.prepare<[string, string, string, number]>(`
          INSERT INTO session_identity_subjects
            (identity_id, channel, subject_id, linked_at)
          VALUES (?, ?, ?, ?)
        `).run(id, channel, subjectId, now);
      });
    } catch (err) {
      // A concurrent writer may have created the same subject; treat
      // UNIQUE collisions as a normal idempotent read.
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        const raceWinner = this.findBySubject(channel, subjectId);
        if (raceWinner) return raceWinner;
      }
      throw err;
    }
    return this.get(id)!;
  }

  private subjectsFor(id: SessionId): IdentitySubject[] {
    const rows = this.storage.prepare<[string], SubjectRow>(`
      SELECT * FROM session_identity_subjects
      WHERE identity_id = ?
      ORDER BY linked_at ASC
    `).all(id);
    return rows.map((row) => ({
      channel: row.channel,
      subjectId: row.subject_id,
      linkedAt: row.linked_at,
    }));
  }

  private touchDisplayName(id: SessionId, displayName: string): void {
    this.storage.prepare<[string, number, number, string]>(`
      UPDATE session_identities
      SET display_name = ?, updated_at = ?, last_seen_at = ?
      WHERE id = ?
    `).run(displayName, Date.now(), Date.now(), id);
  }

  private touchLastSeen(id: SessionId): void {
    this.storage.prepare<[number, number, string]>(`
      UPDATE session_identities SET last_seen_at = ?, updated_at = ? WHERE id = ?
    `).run(Date.now(), Date.now(), id);
  }

  private init(): void {
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS session_identities (
        id              TEXT PRIMARY KEY,
        primary_channel TEXT NOT NULL,
        primary_subject TEXT NOT NULL,
        display_name    TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        last_seen_at    INTEGER
      );
      CREATE TABLE IF NOT EXISTS session_identity_subjects (
        identity_id TEXT NOT NULL,
        channel     TEXT NOT NULL,
        subject_id  TEXT NOT NULL,
        linked_at   INTEGER NOT NULL,
        PRIMARY KEY (channel, subject_id)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_subjects_identity
        ON session_identity_subjects(identity_id);
    `);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SessionIdentityStore is closed");
  }
}

function rowToIdentity(row: IdentityRow, subjects: IdentitySubject[]): SessionIdentity {
  return {
    id: asSessionId(row.id),
    primaryChannel: row.primary_channel,
    primarySubjectId: row.primary_subject,
    displayName: row.display_name ?? undefined,
    subjects,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at ?? undefined,
  };
}
