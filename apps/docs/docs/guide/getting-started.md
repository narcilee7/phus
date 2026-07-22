# 快速开始

## 环境要求

- Node.js ≥ 20
- pnpm ≥ 10

## 安装

```bash
# 从源码
git clone https://github.com/phus-lang/phus.git
cd phus
pnpm install

# 或使用 npm
npm install -g @phus/cli
```

## 配置

设置至少一个 API Key：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# 或
export OPENAI_API_KEY=sk-...
# 或
export OPENROUTER_API_KEY=...
```

运行配置向导：

```bash
pnpm exec phus setup
```

## 运行

### TUI 模式（默认）

```bash
pnpm dev
# 或
phus
```

### 单次执行

```bash
pnpm run "列出当前目录的 JS 文件"
# 或
phus run "解释这段代码"
```

### Gateway 模式

```bash
phus gateway --websocket 8080 --sse 8081
```

## 下一步

- [架构设计](./architecture) — 了解 Phus 的设计理念
- [TUI 快捷键](./tui-shortcuts) — 掌握终端界面操作
- [命令参考](../commands/) — 查看所有 CLI 命令
