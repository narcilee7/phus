# Phus 改造路线图

> 目标：让 Phus 成为能解决长程任务、具备自我进化能力、并易于部署分发的自治 Agent 运行时。以 Hermes Agent 为标杆，快速补齐执行闭环、学习闭环与部署体验。

---

## 1. 目标与成功标准

### 1.1 最终目标

6-8 周内交付一个可演示的 MVP：用户给出一个复杂任务（例如“调研 3 个竞品并整理成 Markdown 报告”），Phus 能够：

1. 自动分解任务并生成可验证的执行计划；
2. 在多步执行中调用工具/子代理，处理失败与重试；
3. 完成后自动反思，萃取可复用 skill 并持久化；
4. 下次遇到同类任务时，优先调用已验证 skill；
5. 通过 `phus gateway` 长期驻留，支持 Telegram/Slack/Email 等通道。

### 1.2 关键验收指标

| 指标 | 当前 | MVP 目标 |
|---|---|---|
| 单次任务可执行步数 | 1-3 步 | 5-10 步 |
| 长程任务成功率 | 低 | ≥ 60%（明确需求下） |
| Skill 自动生成率 | 0 | 每完成一个复杂任务生成 1 个 skill draft |
| Skill 验证后采纳率 | 0 | ≥ 50% |
| 部署方式 | 手动启动 | systemd/launchd + Docker |
| 核心通道 | CLI/TUI/Telegram/WS/SSE | + Slack/WhatsApp/Email |

---

## 2. 现状评估

### 2.1 已有优势

- **Hook 架构**：17 个 hook 点，可在 turn 各阶段插入规划、验证、反思逻辑。
- **SQLite Tape**：append-only 事件流，为长程任务复盘和自我进化提供审计基础。
- **meta tools**：`skill_write`、`self_reflect`、`compact_session`、`startup_write` 已存在。
- **Provider Mesh**：支持多 provider 故障转移，模型切换灵活。
- **Channel 抽象**：CLI/TUI/Telegram/WebSocket/SSE 已可运行。

### 2.2 核心缺口

| 领域 | 缺口 |
|---|---|
| 长程执行 | 无显式 plan 数据结构；单次 turn 内无 inner execution loop；无验证与重试机制；无子代理。 |
| 自我进化 | meta tools 需要用户/Agent 显式调用，无自动触发机制；skill 生成后无质量验证；无版本淘汰。 |
| 部署分发 | 无一键安装脚本；gateway 仅前台运行；无守护进程集成；通道数量少。 |
| 工程质量 | `pnpm typecheck` 存在类型错误；测试覆盖不足以支撑大规模重构。 |

---

## 3. 整体架构演进

改造后的 Phus 保留三层架构，但在 Core 层新增三个子系统：

```
Channels  (channels/, tui/, commands/)
Bridge    (bridge/)
Core
  ├─ runtime/hook.ts            # 已有
  ├─ runtime/planner.ts         # 新增：任务规划与计划管理
  ├─ runtime/executor.ts        # 新增：长程执行循环
  ├─ runtime/verifier.ts        # 新增：步骤验证与错误恢复
  ├─ runtime/subagent.ts        # 新增：子代理调度
  ├─ runtime/learner.ts         # 新增：反思与 skill 萃取
  ├─ runtime/scheduler.ts       # 已有，增强
  ├─ session/tape.ts            # 已有
  ├─ session/plan-store.ts      # 新增：计划持久化
  ├─ session/skill-registry.ts  # 已有，增强验证流程
  └─ safety/policy.ts           # 已有，扩展至子代理
```

---

## 4. Phase 1：长程任务执行能力（第 1-4 周）

### 4.1 核心抽象

#### Plan / Step 数据模型

新增 `src/core/runtime/plan/types.ts`：

```typescript
export interface Plan {
  id: string;
  sessionId: string;
  goal: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export interface Step {
  id: string;
  index: number;
  description: string;
  tool?: string;           // 建议使用的 tool
  expectedOutput?: string; // 预期结果，用于验证
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  retryCount: number;
  dependsOn?: string[];    // 依赖的 step id
}
```

#### 执行状态机

```
User Goal
   │
   ▼
Create Plan  ←── planner.ts
   │
   ▼
Pick Next Step
   │
   ▼
Execute Step  ←── executor.ts (tool call / sub-agent / LLM)
   │
   ▼
Verify Step   ←── verifier.ts
   │
   ├─ ok ──→ Mark completed ──→ 还有步骤？ ──→ Pick Next Step
   │                              │
   └─ fail ──→ Retry? / Escalate? └─ 无 ──→ Summarize & Reflect
```

### 4.2 关键模块

#### 4.2.1 `src/core/runtime/planner.ts`

职责：根据用户目标生成初始计划。

- 输入：`goal`（用户目标）、`context`（当前 session 摘要、已有 skills）
- 输出：`Plan`
- 实现：调用 LLM，要求输出 JSON 格式的 Plan；prompt 中注入 skill registry，使其能引用已知 skill。
- Hook 点：新增 `plan_created`，允许插件修改 plan。

#### 4.2.2 `src/core/runtime/executor.ts`

职责：执行单个 step。

- 如果 step.tool 存在，调用对应 tool；
- 如果 step 需要复杂推理，spawn sub-agent；
- 如果 step 只需自然语言，走普通 LLM call；
- 将结果写回 `step.result`。

#### 4.2.3 `src/core/runtime/verifier.ts`

职责：验证 step 结果是否符合预期。

```typescript
export interface VerificationResult {
  ok: boolean;
  confidence: number;      // 0-1
  reason: string;
  action: 'proceed' | 'retry' | 'replan' | 'escalate' | 'abort';
}
```

- 轻量验证：字符串匹配、JSON schema 校验、退出码检查；
- 智能验证：调用 LLM 对比 `expectedOutput` 与 `result`；
- 根据结果触发重试、重规划或升级。

#### 4.2.4 `src/core/runtime/subagent.ts`

职责：管理子代理生命周期。

```typescript
export interface SubAgentOptions {
  task: string;
  parentSessionId: string;
  context?: string;        // 需要传递给子代理的上下文
  maxSteps?: number;
  sandbox?: 'host' | 'docker';
}
```

- 子代理获得新的 `sessionId`，但在 Tape 中标记 `parentSessionId`；
- 子代理完成后，主 Agent 通过 `self_reflect` 读取结果；
- 初期可用同进程内新 `PhusAgent` 实例实现，后续迁移到 Docker sandbox。

#### 4.2.5 `src/core/session/plan-store.ts`

职责：将 Plan 持久化到 SQLite，支持断点续执行。

- 新增 `plan` 表：`id`, `session_id`, `status`, `payload`, `updated_at`；
- 每个 turn 开始时检查是否有未完成的 plan，有则继续执行；
- 通过 `,plan resume` internal command 支持手动恢复。

### 4.3 改动清单

| # | 改动 | 文件/模块 | 优先级 |
|---|---|---|---|
| 1 | 新增 Plan/Step 类型 | `src/core/runtime/plan/types.ts` | P0 |
| 2 | 实现 Planner | `src/core/runtime/planner.ts` | P0 |
| 3 | 实现 Executor | `src/core/runtime/executor.ts` | P0 |
| 4 | 实现 Verifier | `src/core/runtime/verifier.ts` | P0 |
| 5 | 实现 SubAgent | `src/core/runtime/subagent.ts` | P1 |
| 6 | 实现 Plan Store | `src/core/session/plan-store.ts` | P0 |
| 7 | 扩展 HookName | `src/types/hooks/index.ts` | P0 |
| 8 | 修改 `PhusAgent.turn()` 支持 plan 执行循环 | `src/bridge/pi-agent.ts` | P0 |
| 9 | 新增 `,plan` internal commands | `src/core/runtime/internal-commands/builtins/plan.ts` | P1 |
| 10 | 补充单元/集成测试 | `test/planner.test.ts`, `test/executor.test.ts` | P0 |

### 4.4 验收标准

- [ ] 用户输入“帮我调研 X 竞品并写报告”，Agent 能输出 ≥5 步的 plan；
- [ ] 每个 step 执行后有明确 success/failure 判断；
- [ ] 单 step 失败时能重试至少 1 次；
- [ ] 复杂 step 能 spawn sub-agent 并在完成后汇总结果；
- [ ] Plan 持久化到 SQLite，进程重启后可 `,plan resume`；
- [ ] 新增代码通过 `pnpm typecheck` 和 `pnpm test`。

---

## 5. Phase 2：自我进化闭环（第 3-6 周）

### 5.1 反射机制

#### 自动触发时机

1. 长程任务完成后（plan status = completed/failed）；
2. 用户明确给出纠正/表扬后；
3. 每 N 个 turn 或每固定时间窗口（cron）。

#### 反射内容

新增 `src/core/runtime/learner.ts`：

```typescript
export interface Reflection {
  sessionId: string;
  task: string;
  outcome: 'success' | 'partial' | 'failure';
  whatWorked: string[];
  whatFailed: string[];
  reusableProcedure?: string;
  suggestedSkill?: SkillDraft;
}
```

- 从 Tape 中读取本次任务的 trajectory；
- 调用 LLM 生成 Reflection；
- 如果识别出可复用流程，生成 skill draft。

### 5.2 Skill 萃取与验证

#### 5.2.1 Skill Draft

新增 `src/infra/skills/draft.ts`：

```typescript
export interface SkillDraft {
  name: string;
  version: string;
  description: string;
  trigger: string;         // 什么场景下触发
  procedure: string;       // 详细步骤
  sourceSessionId: string;
  verified: boolean;
}
```

#### 5.2.2 验证流程

1. **Draft 阶段**：skill 写入 `.phus/skills/drafts/<name>/SKILL.md`，不加载到 prompt；
2. **匹配阶段**：planner 遇到相似任务时，提示 Agent “发现候选 skill，是否试用？”；
3. **A/B 阶段**：一次用 skill，一次不用，比较结果质量/步数/成本；
4. **Promote 阶段**：验证通过后移动到 `skills/<name>/SKILL.md`；
5. **淘汰阶段**：长期未使用或验证失败的 draft 被归档到 `.phus/skills/archive/`。

#### 5.2.3 与现有 Skill Registry 集成

- `src/infra/skills/registry.ts` 增加 `discoverDrafts()`、`promoteDraft()`、`archiveDraft()`；
- `src/infra/meta/skill-tools.ts` 增加 `skill_validate` meta tool。

### 5.3 Startup 自适应

当前 `startup_write` 只能由 Agent 显式调用。改造后：

1. 新增 `startup.sh` 生成规范：只包含安全命令（cron 任务、轻量检查）；
2. Agent 根据高频任务自动建议 startup 条目；
3. 用户/操作者确认后才写入；
4. gateway 启动时执行 `startup.sh`，输出记录到 Tape。

### 5.4 改动清单

| # | 改动 | 文件/模块 | 优先级 |
|---|---|---|---|
| 1 | 新增 Reflection 类型与 Learner | `src/core/runtime/learner.ts` | P0 |
| 2 | 新增 Skill Draft 生命周期 | `src/infra/skills/draft.ts` | P0 |
| 3 | 扩展 Skill Registry | `src/infra/skills/registry.ts` | P0 |
| 4 | 新增 `skill_validate` meta tool | `src/infra/meta/skill-tools.ts` | P0 |
| 5 | 在 plan 完成后自动触发 reflection | `src/bridge/pi-agent.ts` | P0 |
| 6 | Planner 引用候选 draft skill | `src/core/runtime/planner.ts` | P1 |
| 7 | 实现 skill A/B 验证 | `src/core/runtime/learner.ts` | P1 |
| 8 | 规范 startup.sh 生成流程 | `src/infra/meta/system-tools.ts` | P1 |
| 9 | 补充测试 | `test/learner.test.ts`, `test/skill-draft.test.ts` | P0 |

### 5.5 验收标准

- [ ] 长程任务完成后自动生成 Reflection；
- [ ] Reflection 中识别出可复用流程时，生成 skill draft；
- [ ] Draft skill 被候选使用后，验证通过则自动 promote；
- [ ] 验证失败的 skill 不会污染正式 skill registry；
- [ ] 同一任务第二次执行时，使用已验证 skill 的步骤数/成功率明显改善。

---

## 6. Phase 3：部署与分发（第 5-8 周）

### 6.1 安装与守护

#### 6.1.1 一键安装脚本

新增 `scripts/install.sh`：

```bash
#!/bin/bash
# curl -fsSL https://phus.dev/install.sh | bash
set -e

# 1. 检查/安装 Node 20+
# 2. 安装 pnpm
# 3. git clone 或下载 release tarball
# 4. pnpm install
# 5. 创建 ~/.phus/ 目录结构
# 6. 提示运行 phus setup
```

对应 PowerShell 脚本 `scripts/install.ps1`。

#### 6.1.2 Gateway 守护进程

新增 `src/commands/gateway-daemon.ts`：

- `phus gateway install`：写入 systemd user service 或 launchd plist；
- `phus gateway uninstall`：移除服务；
- `phus gateway status/start/stop/restart`：管理服务；
- `phus health` 已存在，用于守护进程心跳检查。

### 6.2 关键通道

按优先级补齐通道：

| 通道 | 优先级 | 说明 |
|---|---|---|
| Slack | P0 | B2B 场景刚需 |
| Email (IMAP/SMTP) | P0 | 异步任务入口 |
| WhatsApp | P1 | 个人/海外场景 |
| 飞书 | P1 | 国内场景 |
| WeChat | P2 | 依赖第三方 bridge，风险高 |

每个通道实现 `ChannelAdapter`，复用现有 `src/channels/base.ts`。

### 6.3 Onboarding Wizard

新增 `src/infra/bootstrap/wizard.ts`：

```
$ phus setup
> Welcome to Phus. Let's set up your agent.
[1] Choose model provider (Anthropic/OpenAI/OpenRouter/...)
[2] Enter API key
[3] Enable channels (Telegram/Slack/Email/...)
[4] Configure channel credentials
[5] Test connection
[6] Done — start with `phus gateway start`
```

TUI 版本复用现有 BootstrapWizard（`src/tui/components/BootstrapWizard.tsx`）。

### 6.4 改动清单

| # | 改动 | 文件/模块 | 优先级 |
|---|---|---|---|
| 1 | 编写 install.sh / install.ps1 | `scripts/install.sh`, `scripts/install.ps1` | P0 |
| 2 | 实现 gateway daemon 管理 | `src/commands/gateway-daemon.ts` | P0 |
| 3 | 实现 Slack channel | `src/channels/slack.ts` | P0 |
| 4 | 实现 Email channel | `src/channels/email.ts` | P0 |
| 5 | 实现 WhatsApp channel | `src/channels/whatsapp.ts` | P1 |
| 6 | 实现 setup wizard | `src/infra/bootstrap/wizard.ts` | P0 |
| 7 | 更新 deployment 文档 | `documents/Deployment.md` | P1 |
| 8 | 发布 Docker 镜像优化 | `Dockerfile`, `docker-compose.yml` | P1 |
| 9 | 补充部署相关测试 | `test/gateway-daemon.test.ts` | P1 |

### 6.5 验收标准

- [ ] 新用户能在 5 分钟内通过一条命令安装 Phus；
- [ ] `phus gateway install` 后，服务随系统启动；
- [ ] Slack/Email 通道能收发消息并进入 turn pipeline；
- [ ] `phus setup` 完成 provider + 通道配置；
- [ ] Docker 镜像能一键运行 gateway 模式。

---

## 7. 技术债务与前提

在启动改造前，必须清理以下技术债务：

| 问题 | 影响 | 解决方案 |
|---|---|---|
| `pnpm typecheck` 失败 | 大规模重构无法安全进行 | 修复类型声明缺失（telegraf/ws/prismjs/fuse.js），或补充 `@types/*` / 本地 `.d.ts` |
| 测试覆盖不足 | 新模块容易回归 | 每个新增模块配套单元测试；关键路径补充集成测试 |
| 无统一配置加载 | 部署和多通道配置复杂 | 完成 `phus.config.yaml` 作为唯一配置源（已 partial 实现） |
| 缺少沙箱 | 长程任务可能执行危险命令 | Phase 1 先用 policy 兜底，Phase 2 引入 Docker 子代理沙箱 |

### 建议的启动动作

1. 先花 **3-5 天**修复 `typecheck` 和补充核心模块测试；
2.  frozen 现有 TUI 新功能，避免与 Core 改造冲突；
3. 建立 `feat/long-horizon` 长期分支，定期 rebase main。

---

## 8. 时间线

```
Week 1:  修复 typecheck + 测试基础 + Plan/Step 类型 + Planner 初版
Week 2:  Executor + Verifier + Plan Store + 单 turn 内执行循环
Week 3:  Sub-agent + 集成测试 + Planner 引用 skill
Week 4:  Phase 1 验收；启动 Learner + Reflection
Week 5:  Skill draft + skill_validate + 自动 reflection 触发
Week 6:  Skill A/B 验证 + Startup 自适应 + Phase 2 验收
Week 7:  install.sh + gateway daemon + setup wizard
Week 8:  Slack/Email 通道 + Docker 优化 + MVP 验收
```

总投入：约 **8 周**，2-3 名全职工程师（1 名 Core/Bridge，1 名 进化/Skills，1 名 部署/Channels）。

---

## 9. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| LLM plan 质量差，长程任务频繁失败 | 高 | 高 | 限制 MVP 任务域；强制每步 verification；允许用户中途纠正 |
| 生成的 skill 质量低，污染能力库 | 高 | 高 | Draft → A/B → promote 三级验证；人工确认前不自动加载 |
| 多通道并发导致状态混乱 | 中 | 高 | Queue Manager 串行化同 session turn；Plan Store 加乐观锁 |
| 子代理沙箱实现复杂 | 中 | 中 | Phase 1 先用同进程隔离；Phase 2 引入 Docker |
| 类型/测试债务拖慢重构 | 高 | 中 | 开工前强制清理；新增代码不合并除非 typecheck + test 通过 |

---

## 10. 参考与借鉴

| 项目 | 可借鉴内容 |
|---|---|
| **Hermes Agent** | closed learning loop、skill A/B 验证、agentskills.io、MCP 集成、多终端后端、`hermes.sh` 安装脚本 |
| **OpenClaw** | Gateway 控制平面、Heartbeat、Markdown 记忆/身份文件、DM pairing、多通道路由、Skill Workshop |
| **Bub** | Hook chain 语义、operator-equivalence、Tape 哲学 |
| **Pi Agent** | LLM loop、tool dispatch、provider abstraction |

---

## 11. 下一步行动

1. **确认路线**： review 本文档，确认 Phase 范围和资源投入；
2. **技术债务清理**：修复 `pnpm typecheck`，补充核心测试；
3. **开启 Phase 1**：从 `Plan/Step` 类型和 `Planner` 模块开始；
4. **建立里程碑 review**：每周末检查本周验收标准。

---

*文档版本：v1.0*  
*目标读者：Phus 核心开发者*  
*建议 review 后进入 EnterPlanMode 拆分为可执行的 GitHub issues / 任务单。*
