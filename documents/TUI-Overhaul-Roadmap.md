# Phus TUI 深度优化路线图

> 目标：把 Phus TUI 从“能跑”提升到与 Codex CLI、Claude Code 等标杆对齐的“好用、好看、可信任”的终端交互体验。重点解决信息密度低、反馈不及时、审批/工具/长程任务可视化弱、输入效率差的问题。

---

## 1. 目标与成功标准

### 1.1 终局体验

用户打开 `phus` 后，应获得类似 Codex CLI 的沉浸式终端体验：

1. **零配置启动**：无 API key 时进入引导 wizard，不 crash、不抛栈。
2. **输入高效**：`/` 命令补全、`@` 文件/技能/skill 补全、多行输入、历史、粘贴保护、快捷键提示。
3. **反馈及时**：LLM 流式输出、思考过程可收起、工具调用实时状态、文件修改即时 diff。
4. **可视化强**：计划进度条、子代理树、审批面板、代码块操作按钮、检查点/版本提示。
5. **可控可信**：每次危险操作前清晰预览、可一键撤销/重做、可查看“刚刚做了什么”。

### 1.2 关键验收指标

| 指标 | 当前 | 目标 |
|---|---|---|
| TUI 组件/渲染测试覆盖 | 仅 reducer/command 测试 | 新增 15+ ink-testing-library 组件测试 |
| 启动无 key 崩溃率 | 已修复 | 保持 0 |
| 输入补全响应延迟 | 无索引，遍历文件 | < 100 ms（fuse.js + 缓存） |
| 代码块可用操作 | 0（copy 是装饰） | copy / run / insert |
| 工具调用可视化 | 简单 pill | 卡片 + 参数 + 结果 + diff |
| 计划可视化 | 6 行固定面板 | 可展开时间线 + 子代理 |
| 审批体验 | 行内 Y/S/A/N | 独立面板 + 预览 + 可撤销 |

---

## 2. 现状评估

### 2.1 已有能力

- **基础布局**：`Header`/`ChatViewport`/`InputBox`/`StatusBar` 四段式结构，支持 terminal resize。
- **输入**：`MultiLineInput` 支持多行、历史、`/` 前缀建议、`@` 文件建议、CJK 折行。
- **聊天渲染**：Markdown、代码高亮、流式光标、工具结果折叠、`file_write` diff。
- **审批**：`PermissionBar` 行内 Y/S/A/N。
- **命令面板**：Ctrl+K 全局模糊搜索。
- **文件树**：Ctrl+B 侧边栏。
- **计划**：`PlanPanel` 展示目标、进度、当前 step。
- **启动**：`BootstrapWizard` 可引导首次配置。

### 2.2 与 Codex / Claude Code 的核心差距

| 维度 | Phus 当前 | Codex CLI / Claude Code |
|---|---|---|
| **启动容错** | 已修复，但 wizard 不能为已有无 key 配置重新补 key | 任何状态都能进入 TUI 并引导配置 |
| **输入补全** | `/` 仅前缀匹配；`@` 仅文件；无技能/会话补全 | `/` fuzzy、`@` 文件/符号/技能、Tab 智能补全 |
| **流式输出** | 文本 delta 追加，思考过程混在输出中 | 思考过程可折叠，代码块流式高亮 |
| **工具可视化** | 小 pill + 可展开结果 | 卡片式 inline tool call，参数/结果一目了然 |
| **文件修改** | diff 在工具结果里 | 独立 diff review，可 accept / reject / edit |
| **审批** | 行内，仅 memory_write 有预览 | 独立面板，所有危险命令有预览、可撤销 |
| **导航** | 命令面板 + 文件树 | palette 支持最近使用、符号搜索、git diff |
| **计划/长程** | 固定面板 | 可展开时间线、子代理卡片、step 输出 |
| **代码块** | 高亮 + 装饰性 copy | copy / run / insert 真正可用 |
| **状态/检查点** | header 显示 checkpoint 数量 | 每次修改后可 checkpoint/rollback |

---

## 3. 设计原则

1. **信息密度优先**：终端行数宝贵，去掉无意义空白，让每一行都有信息。
2. **流式即真实**：用户应实时看到模型在思考、在调用什么工具、结果是什么。
3. **操作可逆**：任何写入类操作都能预览、撤销、查看 diff。
4. **键盘驱动**：所有高频操作都有明确快捷键，且底部状态栏实时提示。
5. **组件可测**：所有新组件必须能用 `ink-testing-library` 写回归测试。
6. **向后兼容**：现有 slash commands、channel 事件、agent 事件接口不变。

---

## 4. 分阶段改造计划

### Phase 1：布局与输入基础（1-2 周）

**目标**：让 TUI 不再“顶乱”、输入不再卡顿，奠定后续改造基础。

#### 4.1 布局重构

- **动态高度计算**：已完成 `layout-context` 预留行数，但 `sidebarHeight` 仍只等于 `chatHeight`，导致侧边栏底部留空。改为 `sidebarHeight = terminalRows - HEADER_ROWS`，让文件树真正填满左侧。
- **Header 压缩**：当前 header 占 4 行。Codex 风格是 1-2 行紧凑提示。提供 `compactHeader` 模式：一行显示 `model · session · lastOp`，另一行可选显示 stats。
- **StatusBar 增强**：把当前可用快捷键动态显示出来（例如 suggestion 打开时显示 `Tab 补全`、palette 打开时显示 `Enter 选择`）。
- **底部堆栈顺序**：统一为 `PlanPanel → TodoPill → PermissionBar → CommandPalette → StatusBar → InputBox + overlay`，任何 overlay 都由 `bottomOverlayRows` 预留。

涉及文件：
- `src/tui/App.tsx`
- `src/tui/layout-context.tsx`
- `src/tui/components/Header.tsx`
- `src/tui/components/StatusBar.tsx`

#### 4.2 输入体验

- **Slash 命令 fuzzy**：把当前前缀匹配改成 `fuse.js` fuzzy；同时显示命令描述。
- **Mention 补全扩展**：`@` 触发文件、`@skill/` 触发技能、`@session/` 触发历史会话；用统一补全组件。
- **历史持久化**：把 `MultiLineInput` 的 history 写入 `~/.phus/history.jsonl`，支持跨会话保留。
- **粘贴保护**：超过 50 行或 5000 字符时弹出确认，避免误触发提交。
- **快捷键提示浮层**：`Ctrl+?` 显示快捷键 cheatsheet（用 `bottomOverlayRows` 预留）。

涉及文件：
- `src/tui/components/MultiLineInput.tsx`
- `src/tui/components/InputBox.tsx`
- `src/tui/commands.ts`
- 新增 `src/tui/completion.ts`（统一补全逻辑）

#### 4.3 测试

- 新增 `test/tui/App.layout.test.tsx`：验证 overlay 打开时 chatHeight 减少。
- 新增 `test/tui/MultiLineInput.completion.test.tsx`：验证 fuzzy 选择、mention 补全。

---

### Phase 2：聊天渲染升级（2 周）

**目标**：让聊天区域像 Codex 一样信息丰富但不过载。

#### 4.4 消息卡片

- **消息类型化**：把当前扁平 `ChatItem` 升级为可折叠卡片：
  - `UserMessage`：显示输入 + 引用的 @文件 chip。
  - `AssistantMessage`：流式文本 + 可折叠 thinking + token/模型/耗时元数据。
  - `ToolCallCard`：工具名、参数、运行时长、成功/失败态。
  - `ToolResultCard`：结果折叠/展开、错误高亮、文件写入 diff。
- **消息元数据**：在每条 assistant 消息底部显示 `model · tokens · cost · duration`（由 agent 事件提供）。
- **时间戳**：每条消息 hover/聚焦时显示相对时间（`2s ago`）。

涉及文件：
- `src/tui/components/ChatItemView.tsx`（拆分）
- 新增 `src/tui/components/UserMessage.tsx`
- 新增 `src/tui/components/AssistantMessage.tsx`
- 新增 `src/tui/components/ToolCallCard.tsx`
- 新增 `src/tui/components/ToolResultCard.tsx`

#### 4.5 代码块与 Diff

- **代码块操作**：`CodeBlock` 的 copy 真正写入剪贴板（`node:child_process` + `pbcopy`/`xclip`）；增加 `Run`（bash/python）和 `Insert`（到当前文件）。
- **Diff Review 模式**：`file_write` 不再只渲染在工具结果里，而是生成独立 `DiffReview` 组件，支持 `y accept · n reject · e edit`。
- **Markdown 增强**：表格渲染对齐、任务列表 `[ ]` / `[x]` 可视化、数学公式保留原样。

涉及文件：
- `src/tui/components/CodeBlock.tsx`
- `src/tui/components/DiffView.tsx`
- 新增 `src/tui/components/DiffReview.tsx`
- `src/tui/components/Markdown.tsx`

#### 4.6 流式体验

- **思考折叠**：`append_thinking` 默认折叠在 `⋯ thinking` 按钮下，点击展开。
- **代码块流式高亮**：流式到达的代码片段在闭合后重新高亮，而不是等全部结束。
- **底部锚定优化**：当前 `justifyContent="flex-end"` + `offset` 滚动在内容超高时表现正常，但小内容时会顶部留白。保持当前行为（聊天底部对齐是行业惯例）。

涉及文件：
- `src/tui/components/AssistantMessage.tsx`
- `src/tui/components/CodeBlock.tsx`
- `src/tui/state.ts`

#### 4.7 测试

- 新增 `test/tui/ChatItemView.test.tsx`：渲染各类型消息。
- 新增 `test/tui/CodeBlock.test.tsx`：copy/run 操作。
- 新增 `test/tui/DiffReview.test.tsx`：accept/reject 交互。

---

### Phase 3：工具、审批与可控性（2 周）

**目标**：让用户对 Agent 的每一次写入都心中有数、可审可逆。

#### 4.8 工具调用可视化

- **Inline Tool Card**：工具调用以卡片形式插入到 assistant 消息流中，而不是底部 `TodoPill` 汇总。
  - 运行中：spinner + 工具名 + 参数摘要。
  - 完成：✓ + 耗时。
  - 失败：✗ + 错误摘要。
- **参数摘要**：对 `bash` 显示命令；对 `file_write` 显示 `path (+n/-m lines)`；对 `memory_write` 显示操作类型。
- **结果展开**：Enter/Space 展开完整结果；结果超长时只显示前 N 行并提供 `/read` 跳转。

涉及文件：
- `src/tui/components/ToolCallCard.tsx`
- `src/tui/components/ToolResultCard.tsx`
- `src/tui/components/TodoPill.tsx`（简化为仅显示当前整体 operation）
- `src/tui/events.ts`

#### 4.9 审批面板

- **独立 PermissionPanel**：当前行内 `PermissionBar` 在 overlay 计算里占 4 行，但缺少聚焦感。改为独立面板，高亮显示：
  - 工具名 + 危险等级
  - 参数预览（所有危险工具，不只是 memory_write）
  - diff 预览（file_write / memory_write / startup_write）
  - 操作：`Y` yes · `S` session · `A` always · `N` no · `Esc`
- **可撤销授权**：新增 `/revoke <tool>` 命令，或在状态栏显示当前已 `always` 授权的工具并提供 `/revoke-all`。

涉及文件：
- `src/tui/components/PermissionBar.tsx` → `PermissionPanel.tsx`
- `src/tui/components/PermissionPreview.tsx`
- `src/tui/state.ts`（增加 `allowedTools` 展示/撤销 action）
- `src/tui/commands.ts`

#### 4.10 检查点 / 撤销

- **Checkpoint 提示**：每次 `file_write` / `skill_write` / `memory_write` 完成后在状态栏显示 `Ctrl+Z undo · /checkpoint list`。
- **`/undo` 真正生效**：当前 `/undo` 只是 system hint。改为调用 tape 的 checkpoint 回滚到上一次安全状态。
- **`/checkpoint` 命令**：`list` / `create` / `restore <id>`。

涉及文件：
- `src/tui/commands.ts`
- `src/core/session/checkpoint.ts`（若不存在则新建）
- `src/bridge/pi-agent.ts`（暴露 checkpoint API）

#### 4.11 测试

- 新增 `test/tui/PermissionPanel.test.tsx`
- 新增 `test/tui/ToolCallCard.test.tsx`
- 新增 `test/commands/checkpoint.test.ts`（undo 集成）

---

### Phase 4：导航与命令面板（1-2 周）

**目标**：让 Ctrl+K 成为“万能入口”。

#### 4.12 Command Palette 2.0

- **最近使用（frecency）**：记录用户最近执行的 slash commands / 打开的文件，排序靠前。
- **分组显示**：Commands / Files / Skills / Sessions / Checkpoints / History 分组。
- **预览窗格**：选中文件时右侧显示前 10 行内容（类似 VS Code quick open）。
- **符号/内容搜索**：集成 `ripgrep` 搜索文件内容（`#symbol` 或 `>query`）。
- **快捷键**：`Ctrl+P` 快速文件、`Ctrl+Shift+P` 命令、`Ctrl+R` 最近会话。

涉及文件：
- `src/tui/components/CommandPalette.tsx`
- 新增 `src/tui/palette-history.ts`
- 新增 `src/tui/palette-groups.ts`

#### 4.13 文件树增强

- **文件搜索**：在 `FileTree` 中按 `/` 过滤当前树。
- **Git 状态**：显示 `M` / `?` / `A` 等 git 状态标识。
- **预览优化**：大文件只读取前 100 行，避免阻塞。
- **操作**：`d` delete · `r` rename · `n` new file（弹出输入框）。

涉及文件：
- `src/tui/components/FileTree.tsx`
- 新增 `src/tui/git-status.ts`

#### 4.14 测试

- 新增 `test/tui/CommandPalette.test.tsx`（扩展现有测试）
- 新增 `test/tui/FileTree.test.tsx`（扩展现有测试）

---

### Phase 5：计划、子代理与长程任务可视化（2 周）

**目标**：把长程任务从“6 行面板”升级成可交互的任务控制中心。

#### 4.15 Plan Timeline

- **可展开时间线**：`PlanPanel` 支持展开为完整时间线，显示每个 step 的：
  - 状态图标 + 描述
  - 运行时长
  - 失败原因 / 重试次数
  - 子代理会话链接
- **操作**：`p` pause / resume · `c` cancel · `r` retry failed step · `Enter` 查看 step 详情。

涉及文件：
- `src/tui/components/PlanPanel.tsx`
- 新增 `src/tui/components/PlanTimeline.tsx`
- `src/tui/state.ts`（增加 plan 操作 action）

#### 4.16 子代理卡片

- **Subagent Card**：当一个 step 由子代理执行时，在 chat 中渲染子代理卡片：
  - 子代理目标
  - 当前状态
  - 进度条
  - 点击/Enter 进入子代理会话（或在新 sidebar 中查看）。
- **会话树**：在 sidebar 新增“Sessions”视图，显示当前会话及其子代理树。

涉及文件：
- 新增 `src/tui/components/SubagentCard.tsx`
- 新增 `src/tui/components/SessionTree.tsx`
- `src/tui/App.tsx`

#### 4.17 计划事件扩展

- 扩展 `subscribeToPlanEvents` 事件：
  - `plan_step_output`：step 产生中间输出，直接渲染到时间线。
  - `plan_step_retry`：重试时更新 retryCount。
  - `plan_paused` / `plan_cancelled`：状态变更。

涉及文件：
- `src/core/runtime/plan-runner.ts`（若存在）
- `src/bridge/pi-agent.ts`
- `src/tui/events.ts`

#### 4.18 测试

- 新增 `test/tui/PlanTimeline.test.tsx`
- 新增 `test/tui/SubagentCard.test.tsx`

---

### Phase 6：启动引导与最终打磨（1-2 周）

**目标**：新用户 5 分钟内顺滑上手，老用户用得爽。

#### 4.19 启动引导

- **安全输入 API key**：当前 `TextStep` 明文显示 key。改为 `secure` 模式：输入显示 `•`，回车后写入 `apiKey` 或 `apiKeyEnv`（优先推荐 env var）。
- **已有配置但缺 key**：`startTui()` 检测到 config 存在但 key 缺失时，不是直接退出，而是进入“补全 key”的 mini wizard。
- **Profile 切换**：wizard 最后一步可让用户选择是否创建多个 profile（work / personal）。

涉及文件：
- `src/tui/components/BootstrapWizard.tsx`
- `src/tui/index.ts`
- `src/tui/components/TextStep.tsx`

#### 4.20 主题与可访问性

- **主题配置**：支持 `phus.config.yaml` 中 `theme: dark|light|high-contrast`，调整 borderColor / dimColor。
- **动画降级**：低性能终端可关闭 spinner 动画。
- **错误边界**：TUI 渲染异常时不崩溃，显示错误面板并允许 `/reload`。

涉及文件：
- `src/tui/theme.ts`（新增）
- `src/tui/components/ErrorBoundary.tsx`（新增）
- `src/infra/config/schema.ts`

#### 4.21 文档与示例

- 更新 `documents/CLI-TUI-UX.md` 为新 TUI 能力索引。
- 在 `README.md` 增加 GIF/截图说明。
- 提供 `docs/TUI-Shortcuts.md` 快捷键清单。

#### 4.22 测试

- 新增 `test/tui/BootstrapWizard.test.tsx`（当前缺失）
- 新增 `test/tui/theme.test.tsx`
- 全量 `pnpm test` 通过。

---

## 5. 时间线

```
Week 1-2:  Phase 1 — 布局与输入基础
Week 3-4:  Phase 2 — 聊天渲染升级
Week 5-6:  Phase 3 — 工具、审批与可控性
Week 7-8:  Phase 4 — 导航与命令面板
Week 9-10: Phase 5 — 计划、子代理与长程任务可视化
Week 11-12: Phase 6 — 启动引导与最终打磨
```

总投入：约 **12 周**，1 名全职前端/TUI 工程师 + 0.5 名 Core 工程师配合事件扩展。

---

## 6. 依赖与前提

| 前提 | 状态 | 说明 |
|---|---|---|
| `pnpm typecheck` 通过 | ✅ | 当前已通过 |
| `pnpm test` 通过 | ✅ | 当前已通过 |
| Agent 事件扩展 | 需配合 | plan_step_output / retry / paused 等 |
| Tape checkpoint API | 需新建/暴露 | 用于 `/undo` 和 `/checkpoint` |
| 剪贴板依赖 | 新增 | `node:child_process` 调用系统剪贴板，不引入 npm 依赖 |

---

## 7. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| 组件改造破坏现有 TUI 测试 | 高 | 中 | 每 phase 先补测试再重构；保持 agent 事件接口不变 |
| 流式渲染性能差（大文件 diff） | 中 | 高 | Diff 默认折叠；大文件分页；虚拟滚动 |
| 快捷键冲突（Ctrl+B / Ctrl+K） | 中 | 低 | 提供可配置 keymap；状态栏实时提示 |
| 新用户引导循环 | 低 | 高 | wizard 写 config 后不再重复启动；缺 key 走补全流程 |

---

## 8. 下一步行动

1. Review 本文档，确认 phase 范围和资源。
2. 从 **Phase 1** 开始：先补 `test/tui/App.layout.test.tsx` 和 `test/tui/MultiLineInput.completion.test.tsx`，再改造布局/输入。
3. 每个 phase 一个独立分支，`pnpm typecheck && pnpm test && pnpm build` 通过后再合并。

---

*文档版本：v1.0*  
*目标读者：Phus 核心开发者 + TUI 负责人*  
*建议 review 后进入 EnterPlanMode 拆分 Phase 1 为可执行任务单。*
