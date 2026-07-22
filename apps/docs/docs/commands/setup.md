# phus setup

交互式配置向导，用于首次设置或修改配置。

```bash
phus setup
```

## 功能

1. **API Key 配置** — 选择 Provider (Anthropic/OpenAI/Gemini/DeepSeek) 并输入 API Key
2. **Provider Profile** — 配置多个 Provider 的优先顺序和备用方案
3. **Channel 配置** — 选择启用哪些通道 (WebSocket/SSE/Telegram 等)
4. **Plugin 配置** — 选择启用哪些插件

## 输出

生成 `phus.config.yaml` 到 `PHUS_HOME` 目录（默认 `./.phus`）。

## 示例

```bash
# 首次设置
phus setup

# 重新配置
cd ~/.phus && phus setup
```

## 相关

- [快速开始](../guide/getting-started)
- [配置参考](../guide/configuration)
