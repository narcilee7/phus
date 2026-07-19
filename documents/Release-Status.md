# Roadmap Status Audit (Intelligence + Split)

> Snapshot of [`documents/Intelligence-Alignment.md`](./Intelligence-Alignment.md) and [`documents/Proposal-Monorepo-Split.md`](./Proposal-Monorepo-Split.md) against the current codebase. Each row says what's landed, what's stub, and what's not started. Last audit: 2026-07-20.

---

## Intelligence phases (north star: memory / self-evolution / code capability)

### Phase 1 — Memory OS

| Acceptance criterion (Intelligence-Alignment.md §8) | State | Evidence |
|---|---|---|
| Memory writes categorized and auditable | ✓ | `packages/runtime/src/infra/memory/store.ts` defines `MemoryCategory` (`facts`, `preferences`, `decisions`, `failures`, `procedures`, `tools`, `style`, `notes`) and `MemoryAuthority` (`user`, `system`, `agent`, `tape`); every `apply()` returns a unified diff for the TUI permission bar. |
| Memory write policy with promotion rules | ✓ | `packages/runtime/src/infra/memory/autonomy.ts` — three modes (`propose` / `approval-list` / `yolo`) with `requireApproval` overriding `autoApprove`. |
| Prompt assembly pulls only the most relevant memory blocks | △ | Wired in `bridge/prompt-assembly.ts`, but retrieval ranking by *recency* + *authority* is partial — section-level scoring exists, query→section matching is shallow. |
| Large memory files degrade gracefully | ✓ | `MEMORY_PROMPT_BUDGET_BYTES = 8 * 1024`, `MEMORY_FILE_SOFT_LIMIT_BYTES = 64 * 1024`. Truncation happens before prompt injection. |
| Tape can show when memory influenced a turn | △ | Tape entries carry `source: "memory"` but the dashboard filter UI is not in place. |

### Phase 2 — Long Task OS

| Acceptance criterion | State | Evidence |
|---|---|---|
| Explicit task state machine (pending / running / paused / blocked / completed / failed) | ✓ | `core/runtime/plan/{planner,plan-runner,types}` — full state machine with retry/replan/escalate paths. |
| Long-running tasks survive interrupt + resume | ✓ | `core/session/plan-store.ts` persists plan state to SQLite; `phus tasks` and `phus resume` resume across sessions. |
| Verifier-driven retry / replan / escalate | ✓ | `core/runtime/verifier/` + `subagent/` — verifier returns confidence; on low confidence the runner either retries the step or escalates. |
| Step outputs and repair decisions persisted | ✓ | Tape stores `plan_step_output` / `plan_step_retry` / `plan_paused` / `plan_cancelled` (`subscribeToPlanEvents`). |

### Phase 3 — Self-Evolution Loop

| Acceptance criterion | State | Evidence |
|---|---|---|
| Reflection after task completion | ✓ | `core/runtime/evolution/learner.ts` runs after each completed turn. |
| Reusable procedure detection | △ | Learner groups by intent; scoring is shallow. Tests in `test/evolution/` cover the basic happy path, not procedure promotion. |
| Skill draft + validator + persistence | ✓ | `core/runtime/evolution/engine.ts` + `infra/skills/draft.ts` + `core/runtime/skill/validator.ts`. |
| Promotion / archive policy | ✓ | `evolution/types.ts` carries `promote` / `archive` transitions with regression evidence. |
| Memory-procedure feedback loop | △ | A procedure reaches memory only when explicitly written by the agent; automatic promotion is not wired. |

### Phase 4 — Code Operator Mode

| Acceptance criterion | State | Evidence |
|---|---|---|
| Codebase map / symbol index | △ | `core/session/repo-file-index.ts` exists but is shallow (file-level, no symbols). |
| Diff review with accept / reject / revise | ✓ | `tui/components/DiffReview.tsx` + `safety.ts` allowlist. |
| Verification after every code change | △ | `verifier/` runs after a step, but post-edit verification on every code-action (not just plan steps) is partial. |
| Failure-aware repair loops | ✓ | Plan runner retries / escalates on verifier failures. |

### Phase 5 — Safety & Reliability

| Acceptance criterion | State | Evidence |
|---|---|---|
| Operator-equivalence policy | ✓ | `infra/safety.ts` — file_write allowlist + bash blocklist. |
| Clear audit trail (every policy decision in tape) | ✓ | Every blocked tool call is recorded as `policy.blocked` in tape. |
| Evaluation suite for memory / planning / repair | △ | No dedicated eval harness. `pnpm test` covers unit behavior; no benchmark on long-horizon tasks. |
| Success / recovery / skill-quality metrics | △ | `evolution/metrics.ts` exists. End-to-end dashboards are partial. |

---

## Monorepo split (Proposal-Monorepo-Split.md)

| Stage | State | Commit |
|---|---|---|
| Stage 0 — scaffold `apps/cli` + `packages/core` | ✓ | `chore(monorepo): stage 0 — scaffold apps/cli and packages/core` |
| Stage 1 — extract `@phus/core` from `@phus/runtime` | △ | Schema decided; physical move deferred because the dependency cascade (Tape → SkillRegistry → logger → hook) is too tangled for one commit. Tracked in TODO. |
| Stage 2 — move bin to `@phus/cli` | ✗ | Blocked on A1 — bin still loads via `tsx packages/runtime/src/phus.ts`. |
| Stage 3 — drop `phus tui` (fall-through only) | ✗ | Default + `phus tui` both still call `startTui()` from `cli/program.ts`. Cleanup deferred. |
| Stage 4 — `apps/gui` rejoins workspace | ✗ | `apps/gui/` doesn't exist in this checkout; ignored per Proposal §7 Stage 4 fallback. |
| Stage 5 — release pipeline + first npm publish | △ | CI + release.yml + release.sh + install.sh are in place; libraries tagged `private: true` so `pnpm publish` won't accidentally publish libs; actual `phus` npm publish awaits Stage 2 (bin → `@phus/cli`). |

---

## Issues.md closure

| # | Issue | Status | Closed by |
|---|---|---|---|
| 1 | Bootstrap paste doesn't fill the API key | ✓ | Fix at `packages/tui/src/components/wizard/{Bootstrap,Key}Wizard.ts` + helper `extractPasteContent` in `runtime/text-utils.ts` + `test/paste-extract.test.ts` |
| 2 | Config YAML watcher (monorepo) lands in a package, not the repo root | ✓ | `resolvePhusHome()` + `findMonorepoRoot()` in `infra/config/loader.ts` + tests |
| 3 | `phus tui` should not exist; `phus` alone wakes the TUI | △ | Proposal marked Stage 3 done; the actual subcommand removal deferred |
| 4 | Split into smaller monorepo runtimes | △ | Stage 0 landed; Stages 1-5 deferred |
| 5 | No release tooling; tests need `cd packages/tui` | ✓ | `pnpm -r test` fans out from root; CI + release.yml + release.sh + install.sh already exist; libraries marked private |
