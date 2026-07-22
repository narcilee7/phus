# Changelog

## [0.1.1] - 2026-07-22

### Added
- fix(release): take first line of node -p output (avoid trailing 'undefined')
- fix(release): include packages/shared in version bump (transitive dep of core/runtime/tui)
- fix(release): publish all 5 packages in dep order; drop --frozen-lockfile in installers
- chore(release): unmark @phus/core, @phus/runtime, @phus/tui, @phus/shared as private for npm publish
- fix(release): pack package.json+lockfile under apps/cli/ to match installer layout
- chore(release): unmark @phus/cli as private for npm publish (Stage 5)
- fix(lint): remove unnecessary regex escape in verifier
- fix(bash): include durationMs in tool result details (B.2.4)
- fix(ci): drop --noEmit from typecheck (composite project refs require emit)
- fix(release): align apps/docs version with rest of monorepo (1.0.0 -> 0.1.0)
- Fix/document aligin (#34)
- fix: align document links in README files (#33)
- Chore/update documents by phus self (#32)
- Chore/update documents by phus self (#31)
- Chore/update documents by phus self (#30)
- fix: production (#29)
- Fix/monorepo err (#28)
- Refactor/phus (#27)
- Refactor/monorepo split (#26)
- Feat/memory os (#24)
- feat: memory os and tui refactor (#23)
- Feat/self evolution more (#22)
- fix(docker): copy tsdown.config.ts into the builder stage (#21)

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
