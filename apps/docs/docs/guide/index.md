# 指南

欢迎使用 Phus！

Phus（西西弗斯）是一个自进化的 AI Agent 运行时，名字来源于希腊神话中的西西弗斯 —— 每一次对话都是一次推石头上山的过程。

## 核心特性

- **自进化**: Agent 可以通过 `skill_write` 和 `startup_write` 在运行时修改自己
- **Hook 架构**: 基于 Bub 的 7 阶段 Hook 链，灵活可扩展
- **Tape 持久化**: SQLite 追加日志，跨会话记忆
- **安全边界**: 人类和 Agent 共享同一套安全策略
- **多通道**: CLI、TUI、WebSocket 等即插即用
- **技能系统**: Markdown + YAML frontmatter，热加载

## 快速导航

- [架构设计](./architecture) - 了解 Phus 的设计理念和架构
- [部署指南](./deployment) - 如何部署 Phus
- [插件开发](./plugins) - 开发自定义插件
