# Proposal: Session as the Aggregate Root

> **Status:** Accepted — implementation in progress; Phases 1–3 landed by 2026-07-24  
> **Decision:** Make `Session` the durable continuity boundary. Keep Tape as a session-owned append-only event log.  
> **Scope:** This document distinguishes shipped phases from target APIs that remain proposed.

---

## 1. Why change

Phus already uses the word “session,” but it does not yet have a Session domain object.

Today, a session is a branded string:

- The default `resolve_session` hook returns `${channel}:${chatId}`.
- `PhusAgent` stores `currentSessionId` and `sessionOverride` beside one mutable Pi `Agent` conversation.
- Tape stores every record in one SQLite table with a `session_id` column.
- Checkpoints, compaction, context selection, plans, commands, and the TUI repeatedly pass around `(tape, sessionId)`.
- Session lists are inferred from `Tape.stats()` rather than loaded from a session catalog.

This makes Tape do two jobs:

1. the append-only audit/event log it is good at; and
2. the implicit domain model for conversation continuity, lifecycle, discovery, switching, and channel identity.

Those jobs should be separated. Tape should record what happened **inside** a Session. It should not be the only evidence that the Session exists.

### 1.1 Current implementation evidence

The current behavior is visible in these paths:

- `packages/runtime/src/bridge/default-hooks.ts` synthesizes a session ID from channel metadata.
- `packages/runtime/src/bridge/pi-agent.ts` owns one Pi `Agent`, sets its `sessionId`, appends tool/turn records, and exposes Tape-first diagnostics.
- `packages/core/src/session/tape.ts` owns the SQLite connection and the global `tape` table.
- `packages/core/src/session/checkpoint.ts`, `compaction.ts`, and `context-select.ts` accept a Tape plus a session ID.
- `packages/core/src/session/plan-store.ts` separately indexes plans by session ID.
- `packages/tui/src/components/session-components/SessionsPanel.ts` builds the session picker from per-session Tape counts.

There is also no complete state boundary when switching IDs. `setNextSessionId()` changes identity, while checkpoint restoration is a separate operation. The target architecture must make save, switch, and hydrate one session-aware operation.

### 1.2 Design goals

The refactor should:

- make Session the aggregate root for durable conversational continuity;
- keep Tape append-only, inspectable, and backward-compatible;
- isolate mutable Pi state between sessions;
- define the same session-addressing model for every channel;
- make session lifecycle explicit without equating network connections with sessions;
- make plans, checkpoints, anchors, context, and audit records reachable through a Session;
- preserve plugin compatibility through a staged migration; and
- avoid solving cross-channel human identity in the same change.

### 1.3 Non-goals

The initial refactor does **not**:

- delete Tape or rewrite existing tape rows;
- merge one human’s Telegram, Slack, CLI, and email activity;
- implement remote or multi-host session synchronization;
- move PlanStore into the Tape database;
- make every channel share one conversation;
- use transport connection IDs as durable identity; or
- change Pi’s model/provider abstraction.

---

## 2. Domain boundaries

### 2.1 Session

A **Session** is the durable continuity boundary for a conversation or task. It answers:

- What ongoing conversation is this turn part of?
- Which history, checkpoint, anchor, and active plan belong to it?
- Is it open, closed, or archived?
- Where did it originate?
- Is it a child of another Session?

A Session is **not**:

- a socket or SSE connection;
- a channel-native user identity;
- the Tape itself;
- the Pi `Agent` instance;
- project-wide memory; or
- a process lifetime.

### 2.2 SessionAddress

A **SessionAddress** is the normalized, channel-derived lookup key used to resolve a Session. It separates transport routing from domain identity.

Conceptually:

```ts
interface SessionAddress {
  channel: string;
  scope: string;
  conversationKey: string;
  threadKey?: string;
}
```

The normalized tuple

```text
(channel, scope, conversationKey, threadKey)
```

must resolve to at most one durable Session.

Examples:

- Slack thread: `("slack", "workspace:T123", "channel:C456", "thread:1712345.0001")`
- Telegram topic: `("telegram", "bot:main", "chat:-100123", "topic:42")`
- CLI named chat: `("cli", "home:/Users/alice/.phus", "named:research", "")`

`SessionAddress` is not exposed as the permanent Session ID. External identifiers can change, contain secrets, collide across workspaces, or be unsuitable for user-facing APIs.

### 2.3 SessionOrigin

**SessionOrigin** records how a Session was first resolved. It contains the channel, scope, conversation/thread keys, and channel-specific metadata needed for diagnostics. It does not claim that a channel user is a globally known person.

Participant data such as Telegram user ID, Slack member ID, or email sender belongs in turn/envelope metadata or a later participant model. It must not silently merge Sessions.

### 2.4 SessionRuntime

A **SessionRuntime** is the ephemeral execution state for one durable Session:

```ts
interface SessionRuntime {
  sessionId: SessionId;
  agent: PiAgent;
  abortController: AbortController;
  inFlightTurn?: Promise<Turn>;
  lastUsedAt: number;
}
```

The exact implementation can differ, but these invariants are required:

1. Pi messages are never shared across Session IDs.
2. Turns for the same Session are serialized.
3. Switching or evicting a runtime persists the state required to resume it.
4. A process restart reconstructs a runtime from the Session’s durable state.
5. Transport disconnect does not destroy the durable Session.

### 2.5 Session-owned resources

A Session owns the domain access to:

- its Tape/event stream;
- checkpoints and the latest resumable message state;
- anchors and compaction state;
- relevant-turn context selection;
- plans scoped to that Session;
- child Sessions created for subagents or isolated scheduled runs; and
- lifecycle metadata.

This does not require every resource to live in one SQLite table or file. Ownership is a domain boundary, not a mandate for physical co-location.

### 2.6 Runtime/global resources

The following remain outside Session:

- project memory (`phus.md`);
- skills and skill drafts;
- provider mesh and model profiles;
- safety policy;
- plugin registry;
- channel adapters; and
- repository-wide file index.

These resources can influence a Session turn, but they are not duplicated into every Session aggregate.

---

## 3. Target model

The following types illustrate the intended contract. Names and fields may change during implementation, but the boundaries should remain.

```ts
type SessionKind =
  | "conversation"
  | "scheduled"
  | "subagent"
  | "system";

type SessionStatus = "open" | "closed" | "archived";

interface SessionOrigin {
  channel: string;
  scope: string;
  conversationKey: string;
  threadKey?: string;
  metadata?: Record<string, unknown>;
}

interface Session {
  id: SessionId;
  kind: SessionKind;
  status: SessionStatus;
  origin: SessionOrigin;
  parentSessionId?: SessionId;
  title?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastTurnAt?: number;
}
```

### 3.1 Identity rules

- `SessionId` is the stable internal identity.
- Existing session IDs remain valid when imported into the catalog.
- Newly created Sessions should use opaque IDs rather than encode channel routing keys.
- `SessionAddress` has a unique lookup constraint independent of the Session ID.
- Channel-native keys remain available in `SessionOrigin` for routing and diagnostics.
- A legacy session whose address cannot be parsed safely is cataloged with a `legacy` origin. Migration must prefer incomplete metadata over a guessed merge.

### 3.2 Status rules

Persist only durable lifecycle states:

- `open`: accepts new turns;
- `closed`: explicitly ended; can be deliberately reopened; and
- `archived`: read-only and omitted from default lists.

Do not persist `active` or `idle` as lifecycle states. Activity is a projection of `lastTurnAt`, in-flight work, and live channel connections. Persisting it would make a clean shutdown look like a domain transition.

### 3.3 Parent-child rules

- A subagent Session has `kind: "subagent"` and a `parentSessionId`.
- A schedule can use one stable Session for repeated runs or create child Sessions when isolation is requested.
- Closing a parent does not silently delete or archive children.
- Archiving a parent can require explicit confirmation if open children remain.
- Child Tape entries remain scoped to the child; parent summaries may reference them through plan events or explicit links.

---

## 4. Target ownership and APIs

### 4.1 SessionStore

`SessionStore` is the catalog/repository. It is the only component that creates, resolves, and changes durable Session lifecycle.

Conceptual surface:

```ts
interface SessionStore {
  resolveOrCreate(address: SessionAddress, options?: CreateSessionOptions): Session;
  create(options: CreateSessionOptions): Session;
  get(id: SessionId): Session | undefined;
  findByAddress(address: SessionAddress): Session | undefined;
  list(filter?: SessionFilter): Session[];
  reopen(id: SessionId): Session;
  close(id: SessionId): Session;
  archive(id: SessionId): Session;
}
```

### 4.2 SessionManager

`SessionManager` coordinates the aggregate with runtime state and session-owned repositories.

Conceptual surface:

```ts
interface SessionManager {
  resolve(address: SessionAddress): Session;
  current(): Session | undefined;
  switchTo(id: SessionId): Promise<Session>;
  newSession(options: CreateSessionOptions): Promise<Session>;
  withRuntime<T>(session: Session, run: (runtime: SessionRuntime) => Promise<T>): Promise<T>;
}
```

`switchTo()` is atomic from the caller’s perspective:

1. finish or reject conflicting in-flight work;
2. checkpoint the previous SessionRuntime when needed;
3. acquire or hydrate the target runtime;
4. update the selected Session; and
5. expose the target only after hydration succeeds.

### 4.3 Session-bound operations

Higher layers should stop passing free `(tape, sessionId)` pairs. The target usage is session-bound:

```ts
session.events.replay();
session.events.append(entry);
session.checkpoints.latest();
session.checkpoints.save(messages);
await session.compact({ keepRecent: 10 });
session.plans.active();
await session.context.select(query);
```

These may be facades over existing functions during migration. The important change is that callers cannot accidentally query one Session ID and write to another.

### 4.4 PhusAgentFacade

Add session-oriented methods before deprecating Tape-first methods:

```ts
getCurrentSession(): Session | undefined;
listSessions(filter?: SessionFilter): Session[];
switchSession(id: SessionId): Promise<Session>;
newSession(options?: NewSessionOptions): Promise<Session>;
closeSession(id: SessionId): Promise<Session>;
```

Compatibility methods such as `getCurrentSessionId()`, `getTapeStats()`, and `replayTape()` remain available during the migration window. New CLI/TUI code should use the session-oriented surface.

---

## 5. Turn pipeline and runtime isolation

### 5.1 Target pipeline

```text
Channel bytes
    │
    ▼
Envelope
    │
    ▼
normalize SessionAddress
    │
    ▼
resolve/load Session aggregate
    │
    ▼
acquire SessionRuntime + per-session execution lane
    │
    ▼
admit_message → load_state → build_prompt
    │
    ▼
Pi Agent loop for this SessionRuntime only
    │
    ├─ before_tool_call → policy → session.events.append(tool_call)
    └─ after_tool_call  → session.events.append(tool_result)
    │
    ▼
render + dispatch outbound
    │
    ▼
save state/checkpoint + append turn + update Session timestamps
    │
    ▼
release execution lane
```

Session resolution must happen before state loading and context construction. The resolved Session, not just its string ID, should be available to all downstream stages.

### 5.2 Runtime registry

The target is a bounded `SessionRuntimeRegistry`:

- one Pi `Agent`/message state per active Session;
- one execution queue or mutex per Session;
- independent abort/follow-up/steering state per Session;
- lazy hydration from the latest checkpoint/anchor/history;
- idle/LRU eviction with checkpoint-before-dispose; and
- shared factories for model, tools, policy callbacks, and prompt assembly.

This permits independent Sessions to run concurrently without sharing messages. Limits must cap resident runtimes and provider concurrency.

A globally serialized “hydrate one Pi Agent, run, save, clear, repeat” strategy is acceptable as a temporary migration bridge. It is not the target because it prevents useful cross-session concurrency and makes isolation depend on perfect reset behavior.

### 5.3 Failure semantics

- Failure to resolve or create a Session rejects the turn before model execution.
- Failure to hydrate a known Session leaves the previously selected runtime unchanged.
- A failed turn can append an error event without advancing `lastTurnAt` as a successful turn.
- Checkpoint failure is observable and must not silently report a successful switch/eviction.
- An archived Session rejects new turns unless explicitly reopened or cloned.

---

## 6. Unified channel addressing

Channels produce `Envelope` values and enough metadata to normalize a `SessionAddress`. They do not create Session rows themselves.

| Channel | Session conversation boundary | Thread boundary | Routing-only identity | Notes |
|---|---|---|---|---|
| CLI chat | selected or named conversation | none | terminal/process | `/new` creates a new Session; it must not only clear messages. |
| CLI one-shot | fresh Session by default | none | process | `--session <id>` explicitly resumes an existing Session. |
| Telegram | bot scope + chat ID | forum topic/message thread ID when present | update/message ID | User ID is participant metadata, not Session identity. |
| Slack | workspace + channel/DM ID | root `thread_ts` | event/message timestamp | Replies in one thread share a Session; separate threads do not. |
| WebSocket | client-supplied `conversationId` | optional client-supplied thread | socket/client UUID | Missing conversation IDs create ephemeral Sessions and return a resumable Session ID. |
| SSE | client-supplied `conversationId` | optional client-supplied thread | connection/client ID | Reconnect continuity must not depend on one HTTP connection. |
| Email | mailbox/account scope + conversation root | `References`/`In-Reply-To` root | IMAP UID | Fall back to `Message-ID` for a new thread. Sender is participant metadata. |
| Scheduler | stable schedule identity | optional isolated run ID | timer invocation | Default: repeated firings are turns in one scheduled Session. |
| Subagent | generated child identity | plan/step origin | worker invocation | Always records `parentSessionId`. |
| System | explicit runtime/system identity | purpose-specific | process | Replaces new writes to magic `_system`. |
| WhatsApp | reserved chat/conversation key | provider thread key if available | webhook delivery ID | Adapter is currently a placeholder; semantics are reserved now. |

### 6.1 Transport disconnects

A disconnect evicts or detaches routing state. It does not close a Session.

Examples:

- WebSocket reconnects with the same `conversationId` resolve the same Session.
- Closing the CLI process leaves named Sessions open.
- Restarting the Slack gateway does not close Slack thread Sessions.

### 6.2 Historical boundary changes

Current Slack history is channel-scoped because `threadTs` is not part of the default Session ID. Current email history is effectively message-scoped because `Message-ID` is used as `chatId`.

The migration must not guess how to repartition old entries:

- historical coarse Sessions remain readable under their legacy IDs;
- newly resolved Slack/email thread Sessions use the normalized address rules;
- no history is copied or merged automatically; and
- an optional later migration tool can let an operator attach or import selected legacy history.

---

## 7. Persistence design

### 7.1 Session catalog

Add a `sessions` table alongside the existing `tape` table. A representative schema is:

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL,
  origin_channel    TEXT NOT NULL,
  origin_scope      TEXT NOT NULL,
  conversation_key  TEXT NOT NULL,
  thread_key        TEXT NOT NULL DEFAULT '',
  parent_session_id TEXT,
  title             TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',
  metadata           TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_turn_at       INTEGER
);

CREATE UNIQUE INDEX idx_sessions_address
  ON sessions(origin_channel, origin_scope, conversation_key, thread_key);
CREATE INDEX idx_sessions_status_updated
  ON sessions(status, updated_at DESC);
CREATE INDEX idx_sessions_parent
  ON sessions(parent_session_id);
```

The final implementation should add validation for known `kind` and `status` values in TypeScript and, where migration safety permits, SQL constraints.

### 7.2 Tape compatibility

The existing `tape` shape remains unchanged:

```text
tape(id, ts, session_id, kind, payload, meta)
```

Rules:

- do not rewrite existing payload JSON;
- do not re-key historical `session_id` values;
- catalog every new Session before appending its events;
- keep replay order and checkpoint/anchor semantics compatible; and
- defer a strict foreign key until all legacy rows have catalog entries.

Tape remains the audit/event-log implementation. “Tape” can remain a user-visible inspection term, but session discovery and lifecycle no longer derive solely from `GROUP BY tape.session_id`.

### 7.3 One storage owner

`Tape` currently owns a private `better-sqlite3` connection. The refactor should introduce one storage owner for the Session catalog and event log so atomic operations do not require a second connection or a raw `getDatabase()` escape hatch.

The storage owner should provide transaction boundaries for operations such as:

- create Session + append its first event;
- append successful turn + update `last_turn_at`;
- checkpoint runtime + mark it safe for eviction; and
- close/reopen Session + append the lifecycle audit event.

PlanStore can remain in `plans.sqlite` initially. Session-level plan APIs delegate to it using `SessionId`; physical database consolidation is not required.

### 7.4 Legacy bootstrap

On startup or explicit migration:

1. create the `sessions` table idempotently;
2. select distinct Tape session IDs not yet cataloged;
3. preserve each legacy ID as the Session ID;
4. parse known channel prefixes only when unambiguous;
5. otherwise use a `legacy` channel/scope and retain the original ID in metadata;
6. derive timestamps from the first and latest Tape rows; and
7. never merge two legacy IDs automatically.

The current `_system` bucket becomes a cataloged legacy system Session. New infrastructure events must use an explicit system Session rather than rely on Tape’s fallback.

---

## 8. Lifecycle

### 8.1 Creation

A Session is created by:

- the first admitted inbound turn for a new `SessionAddress`;
- an explicit CLI/TUI “new session” operation;
- scheduler setup or first firing;
- subagent creation; or
- an explicit system operation.

Resolution can happen before admission, but implementation must avoid leaving unlimited empty Sessions from rejected/untrusted messages. Preferred behavior is either:

- resolve an existing Session before admission and create a new one only after admission; or
- create provisionally and remove it transactionally if admission rejects before any event is written.

### 8.2 Close, reopen, archive

- `close` is explicit and durable. It records who/what closed the Session and why.
- `reopen` is explicit; ordinary inbound messages do not silently reopen a closed Session.
- `archive` makes the Session read-only and hides it from default lists.
- a Session can be cloned into a new open Session if an archived history should seed new work.

### 8.3 Runtime eviction

Runtime eviction is not lifecycle closure:

1. wait for or cancel in-flight work according to operator intent;
2. save a checkpoint;
3. remove the SessionRuntime from memory; and
4. leave the durable Session `open`.

### 8.4 Switching

Switching Sessions must save and hydrate atomically. CLI/TUI feedback should not say “switched” until the target runtime is ready. A switch failure retains the previous current Session and its messages.

---

## 9. Hooks and plugins

### 9.1 Compatibility window

Current plugins can read:

```ts
hookCtx.sessionId
hookCtx.tape
```

Both remain available during migration. Add a session-aware contract rather than changing all plugins at once:

```ts
interface HookContext {
  session?: SessionContextLike;
  /** @deprecated */ sessionId?: SessionId;
  /** @deprecated for session-scoped operations */ tape?: TapeLike;
}
```

`SessionContextLike` should be a narrow structural interface, not a concrete runtime class. This preserves the existing package boundary and plugin testability.

### 9.2 `resolve_session`

Evolve the hook in stages:

1. accept existing plugin results that return a string Session ID;
2. prefer a normalized `SessionAddress` result;
3. let SessionManager resolve/materialize the aggregate; and
4. reject new unregistered ad hoc IDs after the compatibility window.

The hook chooses **which continuity address applies**. It should not open SQLite, construct a SessionRuntime, or mutate Pi state.

### 9.3 Context hooks

`build_tape_context` can remain as a compatibility hook name, but new code should reason about session context. A later major release can add `build_session_context` and retain the old hook as an alias before removal.

Plugin guidance should eventually prefer:

```ts
ctx.session.events.append(...)
ctx.session.context.summary(...)
```

rather than a global Tape call plus a manually supplied Session ID.

---

## 10. CLI and TUI behavior

The UI should expose Sessions as entities, not entry-count buckets.

A session list should be able to show:

- title and stable Session ID;
- origin channel and scope;
- thread/conversation label;
- lifecycle status;
- last-turn time;
- active plan/checkpoint availability; and
- event/turn counts as projections.

Expected operations:

- `sessions`: list cataloged Sessions;
- `use <id>`: save current runtime and hydrate the target;
- `new [name]`: create and select a new Session;
- `close <id>` / `reopen <id>` / `archive <id>`;
- `trace <id>`: inspect that Session’s event log; and
- `tape`: retain low-level event-log diagnostics.

The current `/new` behavior only clears the shared conversation. In the target model it must create a new Session identity and runtime.

---

## 11. Migration roadmap

Each phase should be independently releasable and should leave existing Tape data readable.

### Phase 1 — Catalog and types (implemented 2026-07-23)

`packages/core/src/types/session/index.ts`, `session/session-storage.ts`, and `session/session-store.ts` now provide the domain types, shared SQLite owner, additive `sessions` catalog, lifecycle transitions, and idempotent Tape bootstrap. Default runtime construction opens Tape and SessionStore on one connection. The turn pipeline still uses legacy Session IDs directly; later phases remain required.

**Acceptance criteria**

- Existing databases open without destructive migration.
- Every distinct legacy Tape session can be listed as a Session.
- New catalog operations have unit tests for identity, status, address uniqueness, and malformed legacy data.
- Tape replay output is byte-for-byte compatible at the payload level.

**Rollback**

Older binaries ignore the additive `sessions` table and continue reading Tape.

### Phase 2 — Session-bound temporal store (implemented 2026-07-24)

`packages/core/src/session/session-tape.ts` now provides a `SessionTape` view fenced to one `SessionId`. It delegates replay, summary, anchors, checkpoints, compaction, auto-compaction, and relevant-turn selection to the existing canonical helpers. Temporal appends reject cross-session entries before I/O; successful turn writes append the unchanged Tape payload and advance `sessions.last_turn_at` atomically on the shared SQLite connection. The default `PhusAgent` uses this path where safe and retains raw Tape fallbacks for custom dependency injection.

PlanStore remains physically and conceptually outside SessionTape. Hooks, channel normalization, TUI Session entities, and per-session Pi runtimes remain later phases.

**Acceptance criteria**

- New runtime code no longer passes mismatched Tape/session pairs.
- Existing Tape/checkpoint/compaction tests continue to pass.
- Session operations append the same event shapes as before.

**Rollback**

Compatibility adapters preserve the old call signatures.

### Phase 3 — Runtime isolation (implemented 2026-07-24)

`SessionRuntime` and `SessionRuntimeRegistry` give each Session its own Pi `Agent`/messages/abort/plan state, serialize per-Session turns, allow different Sessions to run concurrently within the configured cap, and route TUI/CLI/channel traffic through the active runtime. The public `PhusAgent` facade continues to own shared services, the hook registry, and the plan hook fan-out. Channel address normalization, TUI Session entity migration, and PlanStore consolidation remain proposed.

**Acceptance criteria**

- Alternating turns between two Sessions never share Pi messages.
- Concurrent turns in one Session serialize.
- Concurrent turns in different Sessions can run independently within configured limits.
- Eviction and restart restore the latest durable state.
- Abort, steering, follow-up, and plan controls target the correct SessionRuntime.

**Rollback**

A feature flag may temporarily select the globally serialized hydrate/run/save bridge, while keeping Session persistence unchanged.

### Phase 4 — Channel normalization and UI

Make every adapter provide normalized SessionAddress metadata. Update CLI/TUI session commands and diagnostics.

**Acceptance criteria**

- Slack threads and Telegram topics resolve independently.
- WebSocket/SSE reconnect with a conversation ID preserves continuity.
- Email replies resolve to a conversation root.
- `/new` creates a distinct Session.
- Legacy coarse Sessions remain inspectable and are not silently merged.

**Rollback**

Per-channel configuration can temporarily select legacy address derivation; cataloged Sessions and Tape data remain intact.

### Phase 5 — Plugin/API migration

Add session-aware hook/plugin APIs, migrate meta tools and internal commands, deprecate Tape-first facade methods, and later remove compatibility aliases in a major release.

**Acceptance criteria**

- Old string-returning `resolve_session` plugins pass compatibility tests.
- New plugins can operate without a global Tape handle.
- Deprecation warnings identify the replacement API.
- Documentation distinguishes event-log inspection from Session lifecycle operations.

---

## 12. Architectural decision summary

1. **Session is the aggregate root.**
2. **Tape remains the append-only audit/event log owned by a Session.**
3. **Durable Session and ephemeral SessionRuntime are separate concepts.**
4. **Pi message state is isolated per Session.**
5. **SessionAddress, SessionId, transport routing, and human identity are separate identities.**
6. **Channel conversation/thread boundaries are normalized in this refactor.**
7. **Cross-channel human identity is deferred.**
8. **Existing Tape rows and Session IDs are preserved.**
9. **Disconnect is not close; runtime eviction is not archive.**
10. **Migration is additive and compatibility-first.**
