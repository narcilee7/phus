# phus chat

交互式聊天模式，适合多轮对话。

```bash
phus chat [选项]
```

## 选项

| 选项 | 说明 |
|---|---|
| `--session <id>` | 指定会话 ID |
| `--model <provider/modelId>` | 指定模型 |

## 使用

```
Welcome to Phus TUI. Type /help for commands.

> /help
Available commands:
  /model <provider>/<modelId>  Switch model
  /sessions                    List sessions
  /use <sessionId>             Switch session
  /new                         New session
  /clear                       Clear chat
  /quit                        Exit

> 你好！
[Agent responds...]

> /model openai/gpt-4o
Model switched to openai/gpt-4o

> 继续刚才的话题
[Agent continues...]
```

## 相关

- [run 命令](./run)
- [TUI 快捷键](../guide/tui-shortcuts)
