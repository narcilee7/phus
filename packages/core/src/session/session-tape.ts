import type { SessionId, TurnId } from "../types/brand.js";
import type { TapeAnchorRef, TapeEntry, Turn } from "../types/tape/index.js";
import {
  listCheckpoints,
  loadLatestCheckpoint,
  pruneCheckpoints,
  saveCheckpoint,
  type CheckpointEntry,
} from "./checkpoint.js";
import {
  compactSession,
  type CompactionResult,
} from "./compaction.js";
import {
  maybeCompact,
  type CompactArgs,
  type CompactDecision,
} from "./auto-compact.js";
import {
  selectRelevantTurns,
  type SelectOptions,
} from "./context-select.js";
import type { SessionStorage } from "./session-storage.js";
import type { SessionStore } from "./session-store.js";
import type { Tape } from "./tape.js";

export interface SessionTapeOptions {
  sessionId: SessionId;
  storage: SessionStorage;
  tape: Tape;
  sessionStore: SessionStore;
}

export type SessionCompactionOptions = Parameters<typeof compactSession>[2];
export type SessionAutoCompactArgs = Omit<CompactArgs, "tape" | "sessionId">;

/** A temporal-store view fenced to exactly one durable Session. */
export class SessionTape {
  readonly sessionId: SessionId;
  private readonly storage: SessionStorage;
  private readonly tape: Tape;
  private readonly sessionStore: SessionStore;

  constructor(options: SessionTapeOptions) {
    this.sessionId = options.sessionId;
    this.storage = options.storage;
    this.tape = options.tape;
    this.sessionStore = options.sessionStore;
  }

  append(entry: TapeEntry, meta: Record<string, unknown> = {}): void {
    const entrySessionId = entry.kind === "turn"
      ? entry.turn.sessionId
      : entry.sessionId;
    if (entrySessionId !== this.sessionId) {
      throw new Error(
        `SessionTape fence: entry belongs to ${entrySessionId}, not ${this.sessionId}`,
      );
    }

    const recordedAt = Date.now();
    this.storage.transaction(() => {
      this.sessionStore.ensure(this.sessionId);
      this.tape.append(entry, meta);
      if (entry.kind === "turn") {
        this.sessionStore.recordTurn(this.sessionId, entry.turn.ts, recordedAt);
      }
    });
  }

  *replay(): Generator<TapeEntry> {
    yield* this.tape.replay(this.sessionId);
  }

  summary(limit = 10): string {
    return this.tape.summary(this.sessionId, limit);
  }

  loadAnchor(): TapeAnchorRef | undefined {
    return this.tape.loadAnchor(this.sessionId);
  }

  saveCheckpoint(messages: unknown[], turnId?: TurnId): void {
    this.storage.transaction(() => {
      this.sessionStore.ensure(this.sessionId);
      saveCheckpoint(this.tape, this.sessionId, messages, turnId);
    });
  }

  loadLatestCheckpoint(): CheckpointEntry | undefined {
    return loadLatestCheckpoint(this.tape, this.sessionId);
  }

  listCheckpoints(): CheckpointEntry[] {
    return listCheckpoints(this.tape, this.sessionId);
  }

  pruneCheckpoints(keep = 5): number {
    return pruneCheckpoints(this.tape, this.sessionId, keep);
  }

  compact(options: SessionCompactionOptions = {}): Promise<CompactionResult> {
    this.sessionStore.ensure(this.sessionId);
    return compactSession(this.tape, this.sessionId, options);
  }

  maybeCompact(args: SessionAutoCompactArgs): Promise<CompactDecision> {
    this.sessionStore.ensure(this.sessionId);
    return maybeCompact({
      ...args,
      tape: this.tape,
      sessionId: this.sessionId,
    });
  }

  selectRelevantTurns(query: string, options?: SelectOptions): Turn[] {
    return selectRelevantTurns(this.tape, this.sessionId, query, options);
  }
}
