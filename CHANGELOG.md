# Changelog

## [0.1.4] - 2026-07-23

### Added
- fix(docker): copy monorepo source + workspace dist/ trees; add .dockerignore
- docs(changelog): curate 0.1.3 section (Added/Changed/Fixed)

## [0.1.3] - 2026-07-22

CI-green follow-up to 0.1.2. The previous tag ran the release pipeline
but its commit predates the test-time workspace build step below, so
`pnpm test` ran in a clean CI environment where the workspace package
`dist/` directories were never populated and the deep imports like
`@phus/core/types/logger/index.js` couldn't resolve. 0.1.3 ships the
same release content with CI green and the publish job unblocked.

### Fixed
- `ci.yml` `test` job now runs `pnpm -r build` before `pnpm test`. The
  workspace `test/*.test.ts` files deep-import `@phus/core/dist/...`
  etc. via the package `exports` field, so every workspace package
  needs its `dist/` populated before vitest can resolve those paths.
  A bare `pnpm install --frozen-lockfile` symlinks the workspace
  packages but does not invoke their build scripts, leaving the
  vitest process without the `.js` files it expects — every runtime
  test on Node 20/22 then fails with `ERR_MODULE_NOT_FOUND` for the
  very first deep import it tries to load

## [0.1.2] - 2026-07-22

CI-green follow-up to 0.1.1. The previous tag ran the release pipeline but
its commit predates the Node 22+ exports-wildcard fix below, so its CI
test job was red on `Node 20 is being deprecated. This workflow is
running with Node 24 by default` runners. 0.1.2 ships the same release
content with CI green on the actual published commit. No new user-facing
behavior; install via `npm install -g @phus/cli@0.1.2` (or use the
matching `phus-latest.tar.gz` GitHub Release asset).

### Fixed
- `@phus/core`, `@phus/runtime`, `@phus/shared` package `exports`
  fields now list explicit `*.js` and `**/*.js` patterns alongside the
  existing `*` wildcards. Node 22+ tightened wildcard matching so the
  previous `"./types/*": "./dist/types/*"` no longer matched deep
  imports like `@phus/core/types/logger/index.js` — causing every
  runtime test on Node 24 to fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`
- `ci.yml` adds `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` so the
  runner honors `.nvmrc`'s Node 20 instead of silently substituting 24
  (belt-and-suspenders for the exports fix above)

## [0.1.2] - 2026-07-22

CI-green follow-up to 0.1.1. The previous tag ran the release pipeline but
its commit predates the Node 22+ exports-wildcard fix below, so its CI
test job was red on `Node 20 is being deprecated. This workflow is
running with Node 24 by default` runners. 0.1.2 ships the same release
content with CI green on the actual published commit. No new user-facing
behavior; install via `npm install -g @phus/cli@0.1.2` (or use the
matching `phus-latest.tar.gz` GitHub Release asset).

### Fixed
- `@phus/core`, `@phus/runtime`, `@phus/shared` package `exports`
  fields now list explicit `*.js` and `**/*.js` patterns alongside the
  existing `*` wildcards. Node 22+ tightened wildcard matching so the
  previous `"./types/*": "./dist/types/*"` no longer matched deep
  imports like `@phus/core/types/logger/index.js` — causing every
  runtime test on Node 24 to fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`
- `ci.yml` adds `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` so the
  runner honors `.nvmrc`'s Node 20 instead of silently substituting 24
  (belt-and-suspenders for the exports fix above)

## [0.1.1] - 2026-07-22

First post-monorepo-split release. The five public packages
(`@phus/shared`, `@phus/core`, `@phus/runtime`, `@phus/tui`,
`@phus/cli`) publish to npm in dependency order; the GitHub-Release
tarball matches what `install.sh` / `install.ps1` expect; a fresh
`npm install -g @phus/cli@0.1.1` resolves cleanly on Node 20. CI on
Node 24 runners is **red** for this commit (see 0.1.2 for the fix);
use 0.1.2 on Node 22+ hosts.

### Fixed
- Release pipeline: `@phus/cli` no longer marked `private: true` so
  `pnpm publish` succeeds; the four workspace deps
  (`@phus/core`, `@phus/runtime`, `@phus/tui`, `@phus/shared`) also
  flip to public so a consumer's `npm install @phus/cli` resolves
  them transitively from the registry
- Release pipeline: tarball now packs
  `apps/cli/{package.json,pnpm-lock.yaml}` where `install.sh`
  expects them, so a fresh install ends up with a working
  `node_modules` instead of `ERR_MODULE_NOT_FOUND` on first run
- Release pipeline: `install.sh` and `install.ps1` drop
  `--frozen-lockfile` because the published `@phus/cli/package.json`
  has real version specs for its workspace deps after pnpm rewrites
  `workspace:*` on publish
- Release pipeline: publish all five packages in dependency order
  (`@phus/shared` → `@phus/core` → `@phus/runtime` → `@phus/tui` →
  `@phus/cli`) so the public registry has a consistent set
- Release pipeline: include `packages/shared` in the version bump
  list so its version doesn't drift from `@phus/core` /
  `@phus/runtime` / `@phus/tui`
- Release pipeline: take the first line of `node -p` output (the
  script returns `undefined` after `console.log`, which `tail -1`
  was catching) — caught on this release; prior runs would have
  tagged `vundefined`
- CI: drop `--noEmit` from `pnpm typecheck`. The `composite: true`
  flag in `tsconfig.base.json` requires composite projects to emit,
  and TypeScript 7 surfaces this as `TS6310: Referenced project
  may not disable emit` for every project reference
- `apps/docs` version aligned with the rest of the monorepo
  (`1.0.0` → `0.1.0`); v0.1.0 predates its existence so the orphan
  `1.0.0` had no semantic meaning
- `bash` tool: `details.durationMs` now populated so the B.2.4
  heartbeat test passes and the agent can see command timing
- Lint: removed an unnecessary regex escape in
  `verifier/index.ts:looksLikeJsonShape`

### Note
- Memory OS, self-evolution extensions, and the monorepo-split
  workspace refactor (commits #22–#27 since v0.1.0) are deliberately
  not in this release — they land in 0.2.0. 0.1.1 is a pure
  pipeline-fix release.

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
