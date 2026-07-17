# Changelog

All notable changes to Phus are documented here. Dates are UTC.

## [0.1.0] - 2026-07-17

First public release. Phus ships its full self-evolving agent runtime: a Bub-style hook layer, a SQLite-backed Tape for context and self-reflection, an Agent Skills–compatible skill registry, and a file-based plugin loader. The agent can write new skills to disk at runtime, edit its own startup script, and reflect on past turns — every turn repeats, every turn grows.

### Added
- Long-horizon task execution (Phase 1): planner, executor, verifier, replan loop
- Self-evolution loop (Phase 2): skill drafts, validator, learner, persistence
- Deployment, distribution, and onboarding (Phase 3): config loader, plugin loader, internal `,cmd` registry, multi-channel gateways
- Release pipeline: GitHub Actions CI (typecheck, lint, test, build), npm publish, GitHub Releases, multi-arch Docker images (linux/amd64, linux/arm64) on ghcr.io
- Ink-based interactive TUI: command palette, chat, subagent tree, session tree, skill/session views, terminal filling
- Channels: CLI, Telegram, WebSocket, SSE, Email (IMAP), Slack, WhatsApp
- Meta tools: `skill_write`, `skill_read`, `skill_delete`, `startup_write`, `self_reflect`, `compact_session`, `tape_stats`

### Fixed
- Test imports aligned with the `src/core/runtime/` subdirectory split introduced in `refactor/node_code` (skill/skill-validator, evolution/learner, plan/planner, plan/plan-runner, startup/startup-advisor, executor/{index,error,exit-code}, hook/{registry,ctx-builder}, steering/index, scheduler/index, verifier/index)

[0.1.0]: https://github.com/narcilee7/phus/releases/tag/v0.1.0
