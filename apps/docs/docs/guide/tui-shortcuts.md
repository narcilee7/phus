# TUI 快捷键

> 当前 TUI 支持的所有键盘快捷键。状态栏会在上下文变化时实时显示相关提示。

## 全局

| 快捷键 | 作用 |
|---|---|
| `Ctrl+C` | 终止当前 turn / 退出 TUI |
| `Ctrl+L` | 清空聊天区 |
| `Ctrl+Z` | undo（恢复到上次 checkpoint） |
| `Ctrl+K` 或 `Cmd+K` | 打开命令面板（命令 / 文件 / skill / session） |
| `Ctrl+B` | 切换侧边栏（文件 → sessions → 关闭） |
| `Ctrl+T` | 展开 / 折叠计划时间线（plan active 时） |
| `PgUp` / `PgDn` | 按页滚动聊天 |
| `Ctrl+↑` / `Ctrl+↓` | 按行滚动聊天 |
| `Ctrl+End` | 跳到聊天底部 |
| `Esc` | 收回焦点到输入框 |

## 命令面板 (`Ctrl+K`)

| 快捷键 | 作用 |
|---|---|
| `↑` / `↓` | 在条目间移动 |
| `Enter` | 选中条目（command / insert file / open session） |
| `Tab` | fuzzy 补全 |
| `Esc` | 关闭面板 |

## 文件树 / Sessions 树侧边栏

| 快捷键 | 作用 |
|---|---|
| `↑` / `↓` | 上下移动 |
| `Enter` | 选中并插入到输入框 / 打开会话 |
| `/` | 文件树过滤 |
| `q` 或 `Esc` | 关闭侧边栏 |

## 计划时间线（`Ctrl+T` 展开后）

| 快捷键 | 作用 |
|---|---|
| `↑` / `↓` | 选中 step |
| `Enter` | 在 failed step 上重试 |
| `p` | pause 当前 plan |
| `r` | resume paused plan |
| `c` | cancel 当前 plan |
| `T` 或 `Ctrl+T` | 折叠时间线 |

## Tool call card / Diff review

| 快捷键 | 作用 |
|---|---|
| `Enter` / `Space` | 展开 / 折叠结果 |
| `Esc` | 收回焦点 |

Diff review 内：

| 快捷键 | 作用 |
|---|---|
| `a` | accept changes |
| `r` | reject（revert 文件） |
| `e` | edit（复制到输入框） |

## Code block

| 快捷键 | 作用 |
|---|---|
| `c` | 复制到剪贴板 |
| `r` | 运行代码（bash / python） |
| `i` | 插入到当前输入框 |

## 权限请求面板

| 快捷键 | 作用 |
|---|---|
| `Y` 或 `Enter` | 允许（仅本次） |
| `S` | 允许本 session |
| `A` | 允许 always |
| `N` 或 `Esc` | 拒绝 |

## Subagent card

| 快捷键 | 作用 |
|---|---|
| `Enter` | 打开子代理会话（read-only 显示） |
| `Esc` | 收回焦点 |

## Bootstrap / Key wizard

| 快捷键 | 作用 |
|---|---|
| `↑` / `↓` | 选项切换 |
| `Enter` | 确认 |
| `Backspace` | 删除字符 |
| `Esc` | 返回上一步 / 退出 |

## Slash 命令

| 命令 | 作用 |
|---|---|
| `/help` | 显示命令帮助 |
| `/model <provider>/<modelId>` | 切换模型 |
| `/profiles <name>` | 切换 provider profile |
| `/sessions` | 列出 tape 中的会话 |
| `/use <sessionId>` | 切换下一轮的 session |
| `/checkpoint list\|create\|restore` | checkpoint 管理 |
| `/undo` | 恢复到上一次 checkpoint |
| `/plan create\|run\|status\|list\|resume` | 计划管理 |
| `/subagent show\|files` | 切换 sessions 侧栏 |
| `/reload` | 重载 plugins + skills |
| `/new` | 开启新 session |
| `/clear` | 清空聊天区 |
| `/quit` 或 `/exit` | 退出 |

> 完整 slash 命令列表运行 `/help`。
