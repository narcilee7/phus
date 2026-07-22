# phus run

单次执行一个 prompt，适用于脚本集成。

```bash
phus run <prompt> [选项]
```

## 参数

| 参数 | 说明 |
|---|---|
| `prompt` | 要执行的指令 |

## 选项

| 选项 | 说明 |
|---|---|
| `--session <id>` | 指定会话 ID |
| `--model <provider/modelId>` | 指定模型 |

## 示例

```bash
# 简单查询
phus run "列出当前目录的 JS 文件"

# 指定模型
phus run "解释这段代码" --model anthropic/claude-sonnet-4-20250514

# 管道使用
echo "检查代码格式" | phus run "$(cat)"
```

## 输出

命令模式输出纯文本响应，非命令模式输出完整对话历史。

## 相关

- [快速开始](../guide/getting-started)
- [chat 命令](./chat)
