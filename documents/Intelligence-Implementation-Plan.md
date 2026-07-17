# Intelligence Implementation Plan

> Companion to [`documents/Intelligence-Alignment.md`](./Intelligence-Alignment.md).
>
> Scope: strengthen Phus on `memory`, `self-evolution`, `long-task execution`, and `code capability`.
>
> Non-goal: GUI redesign. UI surfaces can follow later; the intelligence loop lives in the runtime.

---

## 1. Execution Principles

- Keep the runtime local-first and inspectable.
- Prefer durable state over ephemeral prompt tricks.
- Make every important action observable in tape and logs.
- Gate risky writes with explicit policy and permission checks.
- Optimize for long-running tasks that survive interruption and retry.

---

## 2. Workstreams

### A. Memory OS

Goal: turn memory into a retrieval and policy layer, not just storage.

Current base:

- [`src/infra/memory/store.ts`](../src/infra/memory/store.ts)
- [`src/infra/meta/memory-tools.ts`](../src/infra/meta/memory-tools.ts)
- [`src/bridge/prompt-assembly.ts`](../src/bridge/prompt-assembly.ts)
- [`src/infra/memory/autonomy.ts`](../src/infra/memory/autonomy.ts)

Build next:

- Add memory categories for `facts`, `preferences`, `decisions`, `failures`, and `procedures`.
- Add retrieval ranking by recency, relevance, and source authority.
- Add a memory write policy that distinguishes auto-approvable and human-review writes.
- Add summarization and compaction for old entries.
- Add explicit memory provenance in tape entries.

File-level targets:

- [`src/infra/memory/store.ts`](../src/infra/memory/store.ts)
- [`src/infra/memory/index.ts`](../src/infra/memory/index.ts)
- [`src/bridge/prompt-assembly.ts`](../src/bridge/prompt-assembly.ts)
- [`src/infra/meta/memory-tools.ts`](../src/infra/meta/memory-tools.ts)
- [`src/types/tape/entry.ts`](../src/types/tape/entry.ts)
- [`src/commands/trace.ts`](../src/commands/trace.ts)
- [`src/core/session/tape.ts`](../src/core/session/tape.ts)

Acceptance criteria:

- Memory writes are categorized and auditable.
- Prompt assembly can pull only the most relevant memory blocks.
- Large memory files degrade gracefully instead of flooding context.
- Tape can show when memory influenced a turn.

### B. Long Task OS

Goal: make plans resilient across interruption, failure, and recovery.

Current base:

- [`src/core/runtime/plan/planner.ts`](../src/core/runtime/plan/planner.ts)
- [`src/core/runtime/plan/plan-runner.ts`](../src/core/runtime/plan/plan-runner.ts)
- [`src/core/runtime/plan/types.ts`](../src/core/runtime/plan/types.ts)
- [`src/core/runtime/subagent/index.ts`](../src/core/runtime/subagent/index.ts)
- [`src/core/runtime/verifier/index.ts`](../src/core/runtime/verifier/index.ts)
- [`src/core/session/plan-store.ts`](../src/core/session/plan-store.ts)

Build next:

- Promote plan state to a first-class persisted task model.
- Add explicit lifecycle transitions for `pending`, `running`, `paused`, `blocked`, `completed`, and `failed`.
- Track step retries, dependencies, outputs, and recovery decisions.
- Add resume-from-checkpoint behavior for interrupted plans.
- Add a “repair” path when verifier confidence is low.

File-level targets:

- [`src/core/runtime/plan/planner.ts`](../src/core/runtime/plan/planner.ts)
- [`src/core/runtime/plan/plan-runner.ts`](../src/core/runtime/plan/plan-runner.ts)
- [`src/core/runtime/plan/types.ts`](../src/core/runtime/plan/types.ts)
- [`src/core/session/plan-store.ts`](../src/core/session/plan-store.ts)
- [`src/bridge/pi-agent.ts`](../src/bridge/pi-agent.ts)
- [`src/infra/meta/plan-tools.ts`](../src/infra/meta/plan-tools.ts)
- [`src/core/runtime/executor/index.ts`](../src/core/runtime/executor/index.ts)
- [`src/core/runtime/verifier/index.ts`](../src/core/runtime/verifier/index.ts)

Acceptance criteria:

- A long task can be paused and resumed without losing progress.
- A failed step can trigger retry, replan, or escalation.
- Step outputs and repair decisions are persisted.
- The agent can explain why a plan stalled.

### C. Self-Evolution Loop

Goal: make the agent learn from completed work, not just execute work.

Current base:

- [`src/core/runtime/evolution/learner.ts`](../src/core/runtime/evolution/learner.ts)
- [`src/core/runtime/evolution/engine.ts`](../src/core/runtime/evolution/engine.ts)
- [`src/core/runtime/evolution/types.ts`](../src/core/runtime/evolution/types.ts)
- [`src/core/runtime/skill/validator.ts`](../src/core/runtime/skill/validator.ts)
- [`src/infra/meta/evolution-tools.ts`](../src/infra/meta/evolution-tools.ts)
- [`src/infra/skills/draft.ts`](../src/infra/skills/draft.ts)

Build next:

- Strengthen reflection prompts so they infer reusable procedures, not just success/failure.
- Add automatic skill draft scoring based on repeated usefulness.
- Add validation baselines so skill promotion is evidence-based.
- Add draft archiving and regression tracking.
- Feed successful task patterns back into memory and prompt assembly.

File-level targets:

- [`src/core/runtime/evolution/learner.ts`](../src/core/runtime/evolution/learner.ts)
- [`src/core/runtime/evolution/engine.ts`](../src/core/runtime/evolution/engine.ts)
- [`src/core/runtime/evolution/types.ts`](../src/core/runtime/evolution/types.ts)
- [`src/core/runtime/skill/validator.ts`](../src/core/runtime/skill/validator.ts)
- [`src/infra/meta/evolution-tools.ts`](../src/infra/meta/evolution-tools.ts)
- [`src/infra/skills/registry.ts`](../src/infra/skills/registry.ts)
- [`src/bridge/pi-agent.ts`](../src/bridge/pi-agent.ts)

Acceptance criteria:

- Reflection produces actionable reusable procedures more often.
- Skill drafts can be promoted only after passing validation.
- Failed drafts are archived with context, not silently dropped.
- The system remembers which procedures have already been proven useful.

### D. Code Capability

Goal: make Phus behave like a code operator, not just a chat agent.

Current base:

- [`src/bridge/prompt-assembly.ts`](../src/bridge/prompt-assembly.ts)
- [`src/bridge/tools.ts`](../src/bridge/tools.ts)
- [`src/bridge/agent-tool-adapter.ts`](../src/bridge/agent-tool-adapter.ts)
- [`src/core/runtime/executor/index.ts`](../src/core/runtime/executor/index.ts)
- [`src/core/runtime/verifier/index.ts`](../src/core/runtime/verifier/index.ts)
- [`src/core/session/context-select.ts`](../src/core/session/context-select.ts)
- [`src/infra/safety.ts`](../src/infra/safety.ts)

Build next:

- Improve repo-scoped context selection so file relevance is explicit.
- Add code-centric planning that distinguishes inspection, edit, test, and repair phases.
- Strengthen diff-oriented verification for file changes.
- Add repair loops that can re-run the exact failing step with updated context.
- Keep code writes safe, auditable, and reversible.

File-level targets:

- [`src/bridge/prompt-assembly.ts`](../src/bridge/prompt-assembly.ts)
- [`src/core/session/context-select.ts`](../src/core/session/context-select.ts)
- [`src/core/runtime/executor/index.ts`](../src/core/runtime/executor/index.ts)
- [`src/core/runtime/executor/error.ts`](../src/core/runtime/executor/error.ts)
- [`src/core/runtime/verifier/index.ts`](../src/core/runtime/verifier/index.ts)
- [`src/infra/safety.ts`](../src/infra/safety.ts)
- [`src/infra/meta/system-tools.ts`](../src/infra/meta/system-tools.ts)
- [`src/infra/meta/plan-tools.ts`](../src/infra/meta/plan-tools.ts)

Acceptance criteria:

- The agent can explain which files matter before editing.
- Step execution distinguishes read, write, test, and repair phases.
- Verification can fail a step without losing the reason.
- Dangerous file mutations stay gated by policy.

---

## 3. Cross-Cutting Infrastructure

### Observability

Add better visibility into the intelligence loop:

- record plan transitions in tape
- log memory promotions and draft skill outcomes
- log verification failures with enough context to replay
- expose task-level metrics in diagnostics

File targets:

- [`src/core/session/tape.ts`](../src/core/session/tape.ts)
- [`src/infra/logging.ts`](../src/infra/logging.ts)
- [`src/commands/trace.ts`](../src/commands/trace.ts)
- [`src/bridge/pi-agent.ts`](../src/bridge/pi-agent.ts)

### Evaluation

Add tests around the behaviors we care about most:

- memory write and read behavior
- plan retry and resume behavior
- reflection and draft skill generation
- verifier fallback and repair paths
- prompt assembly with memory and relevant tape

Test targets:

- [`test/`](../test)
- [`src/core/runtime/evolution/`](../src/core/runtime/evolution)
- [`src/core/runtime/plan/`](../src/core/runtime/plan)
- [`src/infra/memory/`](../src/infra/memory)

---

## 4. Suggested Order

### Phase 1

- Memory retrieval and compaction
- Memory provenance and logging

### Phase 2

- Plan state hardening
- Retry / resume / repair mechanics

### Phase 3

- Reflection quality improvements
- Skill draft promotion policy

### Phase 4

- Repo-aware context selection
- Diff-aware code execution and verification

### Phase 5

- Metrics, regression tests, and tuning

---

## 5. First Sprint

If we want the highest leverage first sprint, do these in order:

1. Tighten memory retrieval in `prompt-assembly`.
2. Persist richer plan transitions and retries.
3. Improve reflection prompts to output reusable procedures.
4. Add a simple promotion score for skill drafts.
5. Add tests for memory and plan recovery.

That gives us the first closed loop:

- remember more usefully
- plan more durably
- learn from outcomes
- verify before trusting

