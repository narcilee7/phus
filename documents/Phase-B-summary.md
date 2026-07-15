# Phase B — Summary

> From "demo-able" to "production-grade agent you can leave running overnight."

---

## What we built

Phase B delivered five interconnected capability layers, all measured by tests:

| # | Theme | Key files | Tests added |
|---|---|---|---|
| **B.1** | Reliability (retry + isolation + exit codes) | `src/core/retry.ts`, `src/core/exit-codes.ts`, `hook.ts` (isolation) | 17 |
| **B.2** | Long Task (auto-compact + checkpoint + resume + heartbeat) | `src/core/auto-compact.ts`, `src/core/checkpoint.ts`, `src/commands/resume.ts`, `tools.ts` (heartbeat) | 19 |
| **B.3** | Scheduling (cron + ,schedule + config) | `src/core/scheduler.ts`, `src/core/scheduler-runtime.ts`, `internal-commands.ts` | 10 |
| **B.4.2** | Parallel tool execution | `src/core/profile.ts` + `pi-agent.ts` wiring | (manual) |
| **B.4.3** | Smart context selection | `src/core/context-select.ts` + `pi-agent.ts` wiring | 6 |
| **B.4.4** | Reflection draft flow | `src/core/drafts.ts` + `,skill-review.*` | 7 |
| **B.4.5** | Task dashboard | `src/commands/tasks.ts` + `phus tasks` + `/tasks` | 7 |
| | | **Total** | **66** |

Grand total across the project: **139 tests passing in 21 files.**

---

## B.1 Reliability — "the agent doesn't die on flakes"

### What changed

| Surface | Before | After |
|---|---|---|
| Transient HTTP errors (429, 503, network blips) | turn dies immediately | exponential backoff + jitter, respects `Retry-After` header |
| Network errors (ECONNRESET, ETIMEDOUT, fetch failed) | turn dies | auto-retry |
| User errors (400, 401, 403, 404, 422) | retried 5x uselessly | thrown immediately |
| Hook implementation throws | kills whole turn | isolated — chain continues, error logged |
| bash tool transient failure | one shot | retries once with 500ms delay |
| Process exit code | always 1 | 7 distinct codes (USER_ERROR, CONFIG_ERROR, RUNTIME_ERROR, POLICY_BLOCKED, INFRA_ERROR, NOT_FOUND, ALREADY_EXISTS) |

### Critical safety property

`HookRegistry({ isolateErrors: true })` is now the default for `PhusAgent`. A buggy plugin can no longer kill a turn. Operators can still opt out by passing `isolateErrors: false` if they want fail-fast behavior.

### Config additions

```yaml
# bash tool now accepts per-call timeout (B.2.1)
bash: command="..." timeoutMs=60000
```

---

## B.2 Long Task — "crash-resumable, no context explosions"

### Auto-compaction (B.2.5)

Wired into `transformContext` (fires before every LLM call):

```
if messages.length > maxMessages (default 100)
   OR tokens/contextWindow > maxContextFraction (default 0.7):
  compact_session(sessionId, keepRecent=10)
```

Old turns → compressed anchor in Tape. Recent turns preserved verbatim.

**Opt-in via profile**: `autoCompact: true` (default) / `false`.

### Checkpoint + resume (B.2.2 + B.2.3)

Every tool call writes a checkpoint:

```typescript
tape.append({
  kind: "checkpoint",
  sessionId,
  turnId: toolCallId,
  messages: piAgent.state.messages,  // full transcript snapshot
  ts: Date.now() * 1000 + counter,   // monotonic
});
```

Old checkpoints auto-pruned (keep last 5 per session).

Resume:
```bash
phus resume <sessionId> [optional follow-up prompt]
```

Loads latest checkpoint → restores transcript → continues turn.

### Long bash heartbeat (B.2.4)

For `bash` calls with `timeoutMs > 10_000`, every 5s:

```json
{ "event": "tool.bash.heartbeat", "elapsedMs": 15000, "timeoutMs": 30000 }
```

TUI shows `⏵ bash 15s...` instead of dead silence. Result includes `details.durationMs`.

---

## B.3 Scheduling — "the agent wakes itself up"

### Scheduler core

```typescript
Scheduler(hooks)
  .register({ name, cron, hookName, payload?, enabled? })
  .start()    // ticks every 60s
  .stop()
```

On each tick, walks back from now to find the last fire time of each enabled cron — fires if it's within `[since, now]`. Cron validation at registration.

### ,schedule commands

```
,schedule                       list
,schedule.add name=x cron="*/5 * * * *" hookName=before_tool_call
,schedule.remove name=x
,schedule.enable name=x
,schedule.disable name=x
```

### Default schedules from `phus.config.yaml`

```yaml
schedules:
  - name: hourly-checkin
    cron: "0 * * * *"
    hookName: system_prompt
  - name: daily-compact
    cron: "0 3 * * *"
    hookName: save_state
  - name: heartbeat-tick
    cron: "*/15 * * * *"
    hookName: provide_steering_inbox
    enabled: false   # opt-in
```

### Why scheduling matters

This is the foundation for OpenClaw's "Heartbeat" — which we deliberately deferred to Phase C/D. With Phase A hooks already in place (especially `provide_steering_inbox`), a heartbeat is just one more `,schedule.add`. The infrastructure was the hard part.

---

## B.4 Capability — "the agent gets better at its job"

### Parallel tool execution (B.4.2)

```yaml
providers:
  profiles:
    fast:
      toolExecution: parallel   # independent tools run concurrently
```

Pi's native. Default `sequential` (Bub-style, more predictable).

### Smart context selection (B.4.3)

Replaces blind "last-N turns" with relevance scoring:

```
score(turn, query) = jaccard(queryTokens, turnTokens) + 0.3 * recencyBoost
```

Only turns with combined score ≥ threshold (default 0.05) included. Empty query → fall back to last-N.

**Effect**: in long sessions, relevant past context gets surfaced instead of recent-but-unrelated chatter. Phase D can swap in embeddings for semantic search.

### Task dashboard (B.4.5)

```
── Agent ──
  model:    anthropic/claude-sonnet-4-20250514
  thinking: medium
  messages: 12
  checkpoint: 2026-07-15T18:30:15 (8 msgs)
── Sessions (1) ──
  tui:user                            42 entries
── Schedules (3) ──
  ● hourly-checkin          0 * * * *       → system_prompt     next: 2026-07-15T19:00
  ○ heartbeat-tick          */15 * * * *    → provide_steering_inbox
── Recent checkpoints (3) ──
  [2026-07-15T18:25:10] tui:user  tc-3
  ...
```

CLI: `phus tasks`. TUI: `/tasks`. Single source of truth — pulls from Tape + Scheduler runtime.

### Reflection draft flow (B.4.4)

The **safety boundary** for self-evolution:

1. AI wants to write a new skill → goes to `skills/.drafts/<name>/SKILL.md` (inactive)
2. Auto version `0.1.0-draft`, author `ai`
3. Human runs `,skill-review` to see pending drafts
4. `,skill-review.approve name=x` → moves to `skills/<name>/`, version `0.1.0`, author `human`
5. `,skill-review.reject name=x` → deletes

**Invariant**: AI can never directly modify active skills. Every AI-written skill is human-gated before activation.

---

## The architectural narrative

Phase B built **resilience on top of the Phase A hook system**. Every new capability is expressed as either:

1. **A new hook** (e.g., `provide_steering_inbox` lets Heartbeat nudge the agent)
2. **A new `,foo` command** (e.g., `,skill-review`)
3. **A profile field** (e.g., `toolExecution: parallel`)
4. **A Tape entry kind** (e.g., `checkpoint`)
5. **A health/safety primitive** wired into `before_llm_call` (auto-compaction)

This pattern — **extend Bub's primitives rather than bypass them** — is what makes Phus's surface area feel cohesive.

---

## Cumulative state of the project

```
Source files:     39
Tests:            139 passed (21 files)
Commands:         18 total
Public docs:      4 files (Architecture, Plan-correction, Phase-A, Phase-B)
Private docs:     2 files (Plan, Vision)
```

### Hook coverage

| Hook | Source | Status |
|---|---|---|
| `resolve_session` | Bub | ✅ |
| `load_state` | Bub | ✅ |
| `save_state` | Bub | ✅ |
| `build_prompt` | Bub | ✅ |
| `system_prompt` | Bub | ✅ |
| `build_tape_context` | Bub | ✅ |
| `before_llm_call` | Bub | ✅ |
| `after_llm_call` | Bub | ✅ |
| `before_tool_call` | Bub | ✅ |
| `after_tool_call` | Bub | ✅ |
| `render_outbound` | Bub | ✅ |
| `dispatch_outbound` | Bub | ✅ |
| `on_error` | Bub | ✅ |
| `admit_message` | Bub | ✅ |
| `provide_channels` | Bub | ✅ |
| `register_cli_commands` | Bub | ✅ |
| `provide_steering_inbox` | Bub | ✅ |
| `run_model` / `run_model_stream` | Bub | ⚠️ delegated to Pi (intentional) |
| `provide_tape_store` | Bub | ⏸️ deferred (single SQLite backend sufficient) |
| `onboard_config` | Bub | ⏸️ deferred (UX nice-to-have) |

Bub → Phus: **17/20 hooks implemented, 3 deferred with rationale**.

### Commands (18)

| Category | Commands |
|---|---|
| Interactive | `phus` (= `phus chat` = `phus tui`) |
| One-shot | `run`, `resume` |
| Channel | `gateway` |
| Diagnostics | `hooks`, `skills`, `tape`, `policy`, `plugins-list`, `health`, `profiles`, `tasks` |
| Tape | `trace`, `compact` |
| Logs | `logs` |

### Internal commands (15 in TUI/CLI REPL via `,foo`)

`help`, `skills`, `skill`, `tape`, `trace`, `sessions`, `use`, `compact`, `fs.read`, `fs.write`, `reload`, `plugins`, `clear`, `quit`, `policy`, `context`, `schedule` + 5 sub-commands, `skill-review` + 2 sub-commands.

---

## What's deliberately deferred

- **OpenClaw Heartbeat/Cron** — covered conceptually by Phase B.3 (user can compose heartbeat via schedule + steering inbox)
- **OpenClaw LaneQueue (multi-session concurrency)** — single-session per PhusAgent for now; multi-agent needs process-level orchestration
- **Embedding-based context selection** — keyword Jaccard works for MVP
- **`provide_tape_store`** — single SQLite sufficient
- **`onboard_config`** — first-run UX nice-to-have

---

## The next move

The platform is **production-shaped**:
- Reliability: hooks don't kill turns, transient errors retry
- Resilience: checkpoint + resume means crashes aren't fatal
- Observability: structured logs + task dashboard + trace
- Automation: schedules fire hooks on cron
- Safety: AI can't bypass policy or write skills without review
- Capability: parallel tools, smart context, dashboard

**The remaining gap is verification against a real LLM**. Phase A + B + the whole architecture has 139 unit tests but zero integration tests against a live model. The first `phus run "..."` with a working API key will likely surface:
- Schema mismatches
- transformContext timing issues
- Tool call protocol edge cases

That single real-LLM run will validate the whole architecture in a way the unit tests can't.

**Recommended next step**: pick a real LLM endpoint (you have Volcano Ark configured), run `bash scripts/verify-self-evolution.sh`, and report back. Whatever breaks next is the highest-signal thing to fix.
