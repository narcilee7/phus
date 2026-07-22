# 开发进度

> Phus 核心功能的开发状态追踪。来源：[`documents/Release-Status.md`](../../documents/Release-Status.md)

---

## Intelligence phases (north star: memory / self-evolution / code capability)

### Phase 1 — Memory OS

| 验收标准 | 状态 | 说明 |
|---|---|---|
| Memory writes categorized and auditable | ✓ | `MemoryCategory` + `MemoryAuthority` 定义完整 |
| Memory write policy with promotion rules | ✓ | 三种模式：`propose` / `approval-list` / `yolo` |
| Prompt assembly pulls only the most relevant memory blocks | △ | 已接入 retrieval ranking，但匹配较浅 |
| Large memory files degrade gracefully | ✓ | `MEMORY_PROMPT_BUDGET_BYTES = 8 * 1024` |
| Tape can show when memory influenced a turn | △ | `source: "memory"` 已记录，dashboard UI 待完善 |

### Phase 2 — Long Task OS

| 验收标准 | 状态 | 说明 |
|---|---|---|
| Explicit task state machine | ✓ | `plan/planner/plan-runner/types` 完整 |
| Long-running tasks survive interrupt + resume | ✓ | `plan-store.ts` 持久化 + `phus tasks/resume` |
| Verifier-driven retry / replan / escalate | ✓ | `verifier/` + `subagent/` |
| Step outputs and repair decisions persisted | ✓ | `plan_step_output/retry/paused/cancelled` |

### Phase 3 — Self-Evolution Loop

| 验收标准 | 状态 | 说明 |
|---|---|---|
| Reflection after task completion | ✓ | `evolution/learner.ts` |
| Reusable procedure detection | △ | 基础分组已有，评分较浅 |
| Skill draft + validator + persistence | ✓ | `evolution/engine.ts` + `draft.ts` + `validator.ts` |
| Promotion / archive policy | ✓ | `evolution/types.ts` |

### Phase 4 — Code Operator Mode

| 验收标准 | 状态 | 说明 |
|---|---|---|
| Codebase map / symbol index | △ | 仅有文件级索引，无 symbol |
| Diff review with accept / reject / revise | ✓ | `DiffReview.tsx` + `safety.ts` |
| Verification after every code change | △ | verifier 已集成但不够全面 |
| Failure-aware repair loops | ✓ | Plan runner retry/escalate |

### Phase 5 — Safety & Reliability

| 验收标准 | 状态 | 说明 |
|---|---|---|
| Operator-equivalence policy | ✓ | `infra/safety.ts` |
| Clear audit trail | ✓ | 每次 blocked 记录 `policy.blocked` 到 tape |
| Evaluation suite | △ | 无专门 benchmark |
| Success / recovery / skill-quality metrics | △ | `metrics.ts` 存在，dashboard 未完善 |

---

## Monorepo Split

| 阶段 | 状态 | 说明 |
|---|---|---|
| Stage 0 — scaffold apps/cli + packages/core | ✓ | |
| Stage 1 — extract @phus/core | ✓ (facade) | 包边界已存在，物理迁移待完成 |
| Stage 2 — move bin to @phus/cli | ✓ | |
| Stage 3 — drop phus tui | ✓ | |
| Stage 4 — apps/gui rejoins | ✗ | 不存在，已忽略 |
| Stage 5 — release pipeline | △ | CI + release.yml 就绪，npm 发布待 flip private |

---

## Issues 关闭

| # | Issue | 状态 | Closed by |
|---|---|---|---|
| 1 | Bootstrap paste doesn't fill API key | ✓ | Fix in `Bootstrap/KeyWizard.ts` |
| 2 | Config YAML watcher (monorepo) | ✓ | `resolvePhusHome()` + `findMonorepoRoot()` |
| 3 | `phus tui` should not exist | ✓ | 命令已删除 |
| 4 | Split into smaller monorepo runtimes | ✓ | 四 workspace 结构 |
| 5 | No release tooling | ✓ | CI + release.yml + release.sh 就绪 |

**图例**: ✓ 已完成 | △ 进行中 | ✗ 未开始
