# ⛰️ Phus

<p align="center">
  <strong>自进化 Agent 运行时 — 每次轮回，皆有成长。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node ≥20">
  <img src="https://img.shields.io/badge/pnpm-10%2B-orange" alt="pnpm 10+">
</p>

---

Phus 是一个 TypeScript monorepo agent 运行时。它在 [@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core)（LLM 循环 + 工具调用）之上，封装了 [Bub](https://github.com/bubbuild/bub) 风格的 hook 链、基于 SQLite 的 Tape 持久上下文、兼容 [Agent Skills](https://agentskills.io) 标准的技能注册中心，以及一个自进化循环。它可以作为 CLI、TUI 或多渠道网关运行 — 同一 agent、同一套工具、同一套安全规则。

## 为什么选择 Phus？

大多数 agent 框架止步于「LLM + 工具」。Phus 在此基础上，添加了一个长期运行 agent 真正需要的：

### Planner + SubAgent（执行层）

Agent 可以创建并执行**多步骤计划**，基于 DAG 拓扑排序调度。同一层级内的步骤**并行执行**（最多 3 个 sub-agent）—— 每个步骤运行在独立的 **SubAgent** 中，拥有私有消息历史，绝不会污染父 agent。Planner 将目标分解为步骤，DAG 调度器分层执行，sub-agent 自带超时和协作式中断。

```
目标 → Planner → [检查] → [编辑, 测试] (并行) → [修复] → 完成
                    │          │
                    └─ SubAgent ─┘  (独立 Agent, 私有消息)
```

计划持久化在 SQLite 中，重启不丢失；失败时支持 replan（重新规划）；`plan_create` / `plan_run` / `plan_status` 作为**元工具暴露给 agent 自己调用**。

### 自进化循环

Agent 不止使用技能，还会**自己写技能**。14 个元工具让它在运行时自我修改：

| 分类 | 工具 |
|---|---|
| **技能** | `skill_write` — 从经验中创造新能力（Markdown 提示指南，非代码） |
| | `skill_read` / `skill_delete` — 查看或删除技能 |
| | `skill_validate` — A/B 测试技能草案 vs 基线，表现更好则自动晋升 |
| **系统** | `startup_write` — 写启动脚本（下次网关启动时执行） |
| | `startup_suggest` — 分析 tape 和 plan，建议启动脚本新增内容 |
| | `self_reflect` — 跨会话读取历史轮次 |
| | `compact_session` — 压缩旧轮次以释放上下文窗口 |
| **记忆** | `memory_read` / `memory_write` — 维护 `phus.md` 跨会话项目记忆 |
| **进化** | `reflect` — 分析会话，提取成功/失败经验，建议可复用流程 |
| | `plan_create` / `plan_run` / `plan_status` / `plan_list` — 创建和执行多步骤计划 |
| **自省** | `tape_stats` — 按会话统计 |

Evolution Engine 在每次计划完成后运行：反思结果，从可复用流程中生成技能草案，并对照基线验证 —— 闭环：**经验 → 技能 → 验证改进**。

### 外部工具

Agent 通过 6 个工具与真实世界交互：

| 工具 | 用途 |
|---|---|
| `bash` | Shell 命令，通过 `child_process` 执行，带超时 + 中断信号 + 重试 |
| `file_read` | 读取文件，带行号、分页、字节上限 |
| `file_write` | 写入/覆盖文件，自动创建父目录 |
| `edit` | 字符串精确替换（首次匹配或全局替换，含唯一性检查） |
| `grep` | ripgrep 搜索，支持正则、glob 过滤、上下文行、敏感文件过滤 |
| `glob` | 文件发现，支持大括号展开，按修改时间排序 |

### 安全设计

操作等价原则 — agent 和你在同一边界内运行：

- `file_write` 限制在 `./skills/`、`./.phus/`、`./tmp/`、`./out/`
- `bash` 拦截 `rm -rf /`、fork 炸弹、`curl|sh`、`dd if=`、`chmod -R 777 /`、`mkfs`
- 策略在 `before_tool_call` 阶段执行 — 对**所有**工具生效，包括元工具，覆盖**所有**频道
- SubAgent 继承相同的工具列表和安全规则 — 无逃逸通道

## 快速开始

```bash
# 前置条件：Node ≥20, pnpm ≥10
pnpm install

# 设置至少一个 API key
export ANTHROPIC_API_KEY=sk-ant-...
# 或：OPENAI_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY

# 启动 TUI（默认）
pnpm dev

# 单次执行
pnpm run "总结一下这个项目"

# 网关模式（WebSocket + SSE）
pnpm gateway --websocket 8080 --sse 8081
```

运行 `phus setup` 进入交互式配置向导，自动生成 `phus.config.yaml`。

## 架构

```
Channel (CLI / TUI / WebSocket / SSE / Telegram / Slack / Email / WhatsApp)
  │
  ▼
resolve_session → load_state → build_prompt → Pi Agent (LLM + tools)
                                                  │
                              ┌───────────────────┘
                              ▼
                        before_tool_call → 安全策略检查
                        工具执行 (bash, file, meta, …)
                        after_tool_call  → Tape
                              │
                              ▼
                        render_outbound → dispatch_outbound → save_state → Tape
```

每次轮次以只追加方式写入 SQLite Tape。技能 + 记忆 + 相关历史被注入 LLM 上下文。Hook 链（7 阶段，17+ 挂载点）允许插件拦截每个阶段。

## 包结构

```
apps/cli/            @phus/cli         — `phus` 命令行入口
packages/tui/        @phus/tui         — 终端 UI（pi-tui 原语）
packages/runtime/    @phus/runtime     — PhusAgent、桥接、频道、元工具、provider mesh
packages/core/       @phus/core        — hook、tape、技能注册、策略、类型
packages/shared/     @phus/shared      — 协议类型与工具函数
```

依赖方向（单向无环）：

```
apps/cli → packages/tui → packages/runtime → packages/core → packages/shared
```

## 配置

配置文件为 `phus.config.yaml`（由 `phus setup` 生成）。关键环境变量：

| 环境变量 | 用途 |
|---|---|
| `PHUS_HOME` | 主目录（技能、tape、startup.sh）。默认 `./.phus` |
| `PHUS_LOG_FILE` | 结构化 JSONL 日志路径。默认 `./logs/phus.jsonl` |
| `PHUS_LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `PHUS_PROFILE` | 当前 provider profile |

Provider 密钥由 Pi 自动读取。完整配置项见 [`phus.config.example.yaml`](phus.config.example.yaml)（含 provider mesh 熔断、定时任务、频道、插件）。

## 插件与扩展

插件是通过 `jiti` 加载的 TypeScript 文件 — 无需构建。可注册 hook、技能和频道：

```typescript
// ~/.phus/plugins/greet-everyone.ts
import type { Plugin } from "@phus/runtime";

export default {
  name: "greet-everyone",
  register(ctx) {
    ctx.hooks.register("resolve_session", async (c) => `greet:${c.envelope?.from ?? "anon"}`, {
      mode: "first_result",
      priority: 100,
    });
  },
} satisfies Plugin;
```

详见 [`documents/Plugins.md`](documents/Plugins.md)。

## 部署

```bash
docker compose up -d                  # 网关模式，WebSocket 端口 :8080
sudo systemctl enable --now phus      # systemd 服务
```

`phus health` 用于 HEALTHCHECK / watchdog。详见 [`documents/Deployment.md`](documents/Deployment.md)。

## 延伸阅读

- [`documents/Architecture.md`](documents/Architecture.md) — 设计理念、分层架构、Bub/Pi/OpenClaw 借鉴
- [`documents/Proposal-Monorepo-Split.md`](documents/Proposal-Monorepo-Split.md) — Monorepo 拆分理由
- [`documents/Plugins.md`](documents/Plugins.md) — 插件开发指南
- [`documents/Deployment.md`](documents/Deployment.md) — Docker + systemd 部署
- [`documents/Release-System.md`](documents/Release-System.md) — 发布流程
- [`documents/TUI-Shortcuts.md`](documents/TUI-Shortcuts.md) — 快捷键参考
- [`CHANGELOG.md`](documents/CHANGELOG.md) — 版本历史

## 许可证

MIT © 2026 NarciLee
