# 其他命令

## phus logs

查看运行时日志。

```bash
phus logs [选项]
```

| 选项 | 说明 |
|---|---|
| `--tail <n>` | 显示最后 N 行 |
| `--level <level>` | 过滤日志级别 |

## phus tape

查看 Tape 历史记录。

```bash
phus tape [sessionId]
```

无参数时显示当前会话的最近记录。

## phus policy

查看当前安全策略。

```bash
phus policy
```

显示 `file_write` 白名单和 `bash` 黑名单。

## phus profiles

管理 Provider Profile。

```bash
phus profiles [选项]
```

| 选项 | 说明 |
|---|---|
| `list` | 列出所有 Profile |
| `use <name>` | 切换到指定 Profile |

## phus compact

压缩会话，释放上下文窗口。

```bash
phus compact <sessionId>
```

将早期对话总结为 Anchor，保留关键信息。

## phus trace

追踪会话执行。

```bash
phus trace <sessionId>
```

显示每个 Turn 的 Hook 执行和 Tool Call。

## phus resume

恢复会话并继续对话。

```bash
phus resume <sessionId> [prompt]
```

## phus hooks

列出已注册的 Hooks。

```bash
phus hooks
```

## phus plugins-list

列出已加载的插件。

```bash
phus plugins-list
```

## phus metrics

查看运行时指标。

```bash
phus metrics
```

包括 Token 消耗、Tool Call 统计、会话时长等。
