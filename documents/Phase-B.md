# Phase B — Reliability, Long Tasks, Scheduling, Capability

> After Phase A, Phus is Bub-complete. Phase B turns it from "demo-able" into "production-grade agent you can leave running overnight".

---

## B.0 Five themes, organized by dependency

```
B.1 Reliability          foundation: hook error isolation + retry
        ↓
B.2 Long Tasks           uses retry for resume
        ↓
B.3 Scheduling           can use Long Task for "long periodic jobs"
        ↓
B.4 Capability uplift    uses Scheduling for periodic self-improvement,
                         Long Task for parallel tool execution
```

---

## B.1 Reliability (stability + retry)

### Current gaps

| Issue | Symptom | Severity |
|---|---|---|
| No retry on transient API errors | One 429 → turn dies, user sees error | **HIGH** |
| No retry on network blips | Brief TCP reset → turn dies | **HIGH** |
| Hook exception kills turn | One buggy plugin → whole conversation dies | HIGH |
| All exit codes are 1 | Can't tell user errors from infra errors in scripts | MEDIUM |
| No health monitoring | `phus gateway` silent failure after 6h uptime | MEDIUM |
| Plugin load errors leave partial state | One bad plugin → can't `,reload` cleanly | LOW |
| No memory leak check | Long-running gateway accumulates messages | LOW |

### Design

#### B.1.1 Retry policy

```typescript
// src/core/retry.ts
export interface RetryConfig {
  maxAttempts: number;           // default: 5
  initialDelayMs: number;        // default: 1000
  maxDelayMs: number;            // default: 30000
  backoffMultiplier: number;     // default: 2
  jitter: boolean;               // default: true
  retryableStatuses: number[];   // default: [408, 425, 429, 500, 502, 503, 504]
  nonRetryableStatuses: number[]; // default: [400, 401, 403, 404, 422]
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, delayMs: number, error: Error) => void,
): Promise<T>;
```

Wrap the LLM call (Pi's `agent.prompt()`) and the bash tool's `execFile` call.

**Retry strategies:**
- **LLM calls**: exponential backoff with jitter, respect `Retry-After` header
- **bash**: 1 retry on transient errors (network timeout, exit code 124)
- **Meta tools** (`skill_write` etc.): no retry — these are local and should be deterministic

#### B.1.2 Hook error isolation

Change `HookRegistry.execute` to catch and log per-hook errors:

```typescript
// Before: one throw aborts the chain
for (const { impl } of chain) {
  result = await impl(current);  // throw here kills everything
}

// After: each impl wrapped in try/catch
for (const { impl } of chain) {
  try {
    result = await impl(current) ?? current;
  } catch (err) {
    logger.error("hook.failed", { hook: name, error: err.message });
    // continue chain with previous result
  }
}
```

Configurable via `HookRegistry` constructor: `{ isolateErrors: true }`.

#### B.1.3 Distinct exit codes

```typescript
export const ExitCode = {
  OK: 0,
  USER_ERROR: 1,        // bad arguments, unknown command
  CONFIG_ERROR: 2,      // missing API key, invalid profile
  RUNTIME_ERROR: 3,     // turn failed
  POLICY_BLOCKED: 4,     // operator-equivalence policy blocked a tool
  INFRA_ERROR: 5,       // network, DB, file system
} as const;
```

#### B.1.4 Health monitoring loop

`phus gateway` runs a periodic self-check:

```typescript
setInterval(async () => {
  const stats = tape.stats();
  const mem = process.memoryUsage();
  const state = piAgent.state;

  if (mem.heapUsed > 512 * 1024 * 1024) {
    logger.warn("health.high_memory", { heapUsedMb: mem.heapUsed / 1024 / 1024 });
    // trigger auto-compaction (Phase B.4)
  }
  if (stats.totalEntries % 1000 === 0) {
    logger.info("health.checkpoint_reached", { entries: stats.totalEntries });
  }
}, 60_000);  // every minute
```

#### B.1.5 Plugin safe reload

`,reload` currently calls `skills.discover()` + `loadPlugins()`. The bug: if plugin count grows, the agent's existing channel references stay. Add:

```typescript
// On reload: track new vs removed, gracefully close removed channels
const oldChannels = new Set(prevChannels.map(c => c.name));
const newChannels = collectChannels(agent, opts);
for (const ch of newChannels) {
  if (!oldChannels.has(ch.name)) await ch.listen(agent);
}
```

### Tests

- `withRetry` succeeds after N transient failures
- `withRetry` does not retry on 4xx (except 408, 425, 429)
- Hook chain continues after one impl throws
- Exit code reflects error category
- Health check emits warn at memory threshold

---

## B.2 Long Tasks

### Current gaps

| Issue | Symptom | Severity |
|---|---|---|
| Bash default 30s timeout | Long build/deploy gets killed mid-flight | **HIGH** |
| No checkpointing | Agent crashes mid-tool-loop → lose everything | **HIGH** |
| No resume | Can't continue a turn across restarts | **HIGH** |
| No progress for long bash | User stares at "thinking..." for 5 min | MEDIUM |
| Agent state.messages unbounded | Long task fills memory | MEDIUM |
| No way to abort a specific tool | `agent.abort()` cancels whole turn | LOW |

### Design

#### B.2.1 Per-tool timeout

```typescript
// bash tool now accepts timeoutMs in params
parameters: Type.Object({
  command: Type.String(),
  timeoutMs: Type.Optional(Type.Number({ description: "max execution time, default 30000" })),
});
```

`execFile({ timeout: params.timeoutMs ?? 30000 })`.

#### B.2.2 Checkpointing

Save turn progress to disk so we can resume:

```typescript
// src/core/checkpoint.ts
export interface Checkpoint {
  sessionId: string;
  turnId: string;
  ts: number;
  messages: AgentMessage[];      // Pi's transcript
  pendingToolCall?: AgentToolCall;
  policyCheckpoints: Map<string, "ok" | "blocked">;  // already-evaluated
}

export async function saveCheckpoint(tape: Tape, cp: Checkpoint): Promise<void>;
export async function loadCheckpoint(tape: Tape, sessionId: string): Promise<Checkpoint | undefined>;
```

Saved as TapeEntry kind `"checkpoint"`.

When to save:
- After every `after_tool_call` (low-cost, just JSON dump)
- On SIGTERM (graceful)
- On uncaughtException (best-effort)

When to load:
- On `phus run --resume <turnId>` (explicit)
- On `phus gateway` startup (auto-load last unfinished turn per session)

#### B.2.3 Resume

```typescript
// src/commands/resume.ts
program.command("resume <sessionId>")
  .description("Resume the last checkpoint for a session")
  .action(async (sessionId) => {
    const cp = await loadCheckpoint(tape, sessionId);
    if (!cp) {
      console.error("no checkpoint found");
      process.exit(ExitCode.USER_ERROR);
    }
    const agent = new PhusAgent();
    agent._internal.piAgent.replaceMessages(cp.messages);
    // Re-run the pending tool call or continue from where we left off
    await agent._internal.piAgent.continue();
  });
```

#### B.2.4 Progress streaming for long bash

For bash commands with `timeoutMs > 10000`, emit a progress event every 5s:

```typescript
const child = spawn("sh", ["-c", cmd]);
const heartbeat = setInterval(() => {
  logger.debug("tool.bash.heartbeat", { toolCallId, elapsedMs: ... });
  // emit event for TUI to render "⏵ bash running 12s..."
}, 5000);
```

TUI already has tool display — just add elapsed time.

#### B.2.5 Auto-compaction trigger

In health monitor (B.1.4), trigger `compactSession` when:
- `piAgent.state.messages.length > 100`, OR
- estimated tokens > 70% of model.contextWindow

This prevents the Long Task from blowing memory.

### Tests

- Checkpoint roundtrip: save → load → equal
- Resume continues from last checkpoint
- Bash timeout cancels child process
- Auto-compaction fires at threshold
- TUI shows bash heartbeat

---

## B.3 Scheduling (cron / heartbeat)

### Current state

- `startup.sh` runs once on gateway boot — no recurring
- No way to say "wake me up every hour"
- Manual compaction only

### Design

#### B.3.1 Cron-style scheduler

Add a scheduler that fires hooks on a schedule:

```typescript
// src/core/scheduler.ts
export interface Schedule {
  name: string;
  cron: string;        // "*/5 * * * *" = every 5 min
  hookName: HookName;   // which hook to fire
  payload?: Record<string, unknown>;
}

export class Scheduler {
  register(schedule: Schedule): void;
  start(): void;        // begin ticking
  stop(): void;
}
```

Built on `cron-parser` (small dep, no native build).

#### B.3.2 Default schedules

```typescript
// phus.config.yaml
schedules:
  - name: hourly-checkin
    cron: "0 * * * *"            # top of every hour
    hookName: system_prompt      # re-inject system prompt (warm cache)
  - name: daily-compact
    cron: "0 3 * * *"            # 3 AM daily
    hookName: save_state         # trigger auto-compaction in on_save_state hook
  - name: heartbeat-tick
    cron: "*/15 * * * *"         # every 15 min
    hookName: provide_steering_inbox  # could enqueue a "system: still alive?" reminder
```

#### B.3.3 `,heartbeat` and `,schedule` commands

```
,schedule list                      # show all registered schedules
,schedule add name=foo cron="*/5 * * * *" hookName=before_tool_call
,schedule remove name=foo
,schedule enable name=foo
,schedule disable name=foo
```

#### B.3.4 Schedule firing

When a schedule fires:

1. Build a synthetic `HookContext` with the schedule's payload
2. Execute the hook via the existing `HookRegistry.execute` mechanism
3. If hook returns an `Envelope` (e.g., from a custom schedule), enqueue to steering inbox
4. Log `schedule.fired` with name + hook result

This means schedules don't need their own execution path — they just trigger hooks.

### Tests

- Scheduler fires on cron tick (with fake clock)
- Schedule add/remove/enable/disable updates state
- Firing logs structured event
- Multi-schedule coexistence

---

## B.4 Capability uplift

### Current state

- Manual compaction only (B.2.5 makes it automatic)
- Sequential tool execution only (Pi's default)
- Context window: blindly last-10 turns
- No learning from past sessions
- No multi-agent / delegation

### Design

#### B.4.1 Auto-compaction (cross-ref B.2.5)

Hooked into `before_llm_call`:

```typescript
hooks.register("before_llm_call", async (ctx) => {
  const msgs = (ctx.extras as any).messages as AgentMessage[];
  if (estimateTokens(msgs) > ctx.state.contextWindow * 0.7) {
    // call compactSession on the relevant tape slice
    return { compact: true };
  }
});
```

#### B.4.2 Parallel tool execution

Pi has `toolExecution: "parallel"` option. Wire it via profile:

```yaml
providers:
  profiles:
    smart:
      model: anthropic/claude-sonnet-4-20250514
      toolExecution: parallel     # ← new field
```

PhusAgent reads profile, sets `piAgent.toolExecution`.

**Tradeoff**: parallel can cause race conditions in tool outputs. Bub itself doesn't have this concept. Worth experimenting.

#### B.4.3 Smart context selection

Instead of always last-N turns, pick the most relevant ones based on current query:

```typescript
async function selectContext(messages: AgentMessage[], currentQuery: string, budget: number) {
  // Embed current query + recent messages, pick top-K by similarity
  // For MVP: last-N + recent compact anchors
  return [...recentTurns, ...relevantAnchors].slice(0, budget);
}
```

**MVP**: just include recent turn anchors. Embedding-based selection is Phase D.

#### B.4.4 Learning from past sessions

When a turn ends, run a "reflection" pass:

```typescript
// src/core/reflect.ts
async function reflectOnTurn(turn: Turn, llm: Agent): Promise<void> {
  const reflection = await llm.prompt(
    `Review this turn and extract any reusable learnings. ` +
    `If something generalizable came up, write a new skill.`
  );
  if (reflection.skill) {
    await skills.write(reflection.skill);
  }
}
```

**Risk**: could spam skills with bad content. Need approval flow:
- Write to `.phus/skills/drafts/` first
- User runs `,skill-review` to approve/reject
- Approved skills move to `skills/`

#### B.4.5 Task dashboard

```typescript
program.command("tasks")
  .description("show active and queued tasks (long-running turns, schedules)")
  .action(() => {
    const tasks = scheduler.list();
    const checkpoints = tape.findAll(kind="checkpoint");
    // pretty-print
  });
```

Also `/tasks` slash command in TUI showing live task list with elapsed time.

### Tests

- Auto-compaction triggers at threshold
- Parallel tool execution doesn't crash on race
- Reflection draft goes to drafts dir, not main skills
- Tasks command shows live state

---

## B.5 Implementation order (recommended)

| Phase | Effort | Unlocks |
|---|---|---|
| **B.1.1 Retry** | 1 day | Tolerant to flaky networks / rate limits |
| **B.1.2 Hook error isolation** | 0.5 day | Plugins can be buggy without killing agent |
| **B.1.3 Exit codes** | 0.5 day | Scripts can react appropriately |
| **B.2.1 Per-tool timeout** | 0.5 day | Long bash commands work |
| **B.2.2 + B.2.3 Checkpoint + resume** | 2 days | Crash-resistant, resumable across restarts |
| **B.2.5 Auto-compaction** | 1 day | No more "context too long" |
| **B.3 Scheduling** | 2 days | Heartbeat, daily compact, periodic jobs |
| **B.4.4 Reflection (draft flow)** | 2 days | Agent improves itself safely |
| **B.4.2 Parallel tools** | 1 day | Speedup for independent operations |
| **B.4.5 Task dashboard** | 1 day | Visibility into long-running things |

**Total**: ~12 days of focused work.

---

## Open questions

1. **Retry policy default** — Pi already does some internal retry for LLM calls (saw `maxRetryDelayMs`). Do we layer on top, or rely on Pi's? (Recommendation: rely on Pi for LLM, add our own for tools.)
2. **Checkpoint granularity** — every tool call (high frequency, large files) or only at natural breaks (turn end, idle)? (Recommendation: every tool call but compact old checkpoints — keep last 5 per session.)
3. **Auto-compaction policy** — strict (always trigger at 70%) or opt-in (profile decides)? (Recommendation: opt-in via `autoCompact: true` in profile.)
4. **Reflection approval UX** — separate `,skill-review` command, or a `/drafts` panel in TUI? (Recommendation: TUI panel — keeps the user in flow.)
