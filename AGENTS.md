# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

**Phus** — a small Node runtime that wraps `@mariozechner/pi-agent-core` with a Bub-style hook layer, a SQLite tape for context, an Agent Skills–compatible skill registry, and a file-based plugin loader. The agent can write new skills to disk at runtime, edit its own startup script, and reflect on past turns. Named after Sisyphus: every turn repeats, every turn grows.

The full design intent and inspirations (Bub / Pi / OpenClaw) live in [`documents/Architecture.md`](documents/Architecture.md). Read it before making non-trivial changes.

## Common commands

```bash
# Install
npm install
cp .env.example .env        # fill in at least one provider key

# Dev / run (root scripts run tsx directly with cwd=repo root — relative
# paths in phus.config.yaml (./skills, ./tape.sqlite) resolve there. Do
# NOT re-route these through `pnpm --filter`: it changes cwd to the
# package dir and skills/tape/file-writes land in the wrong place.)
pnpm dev                    # tsx packages/runtime/src/phus.ts (default TUI)
pnpm tui                    # tsx packages/tui/src/index.ts
pnpm chat                   # tsx packages/runtime/src/phus.ts chat
pnpm run "..."              # one-shot prompt
pnpm gateway                # tsx packages/runtime/src/phus.ts gateway (multi-channel)

# Build
pnpm build                  # tsdown bundle + tsc declarations → dist/
pnpm build:js               # rolldown bundle only
pnpm build:types            # tsc --emitDeclarationOnly only

# Quality
pnpm typecheck              # tsc --noEmit
pnpm lint                   # oxlint --quiet src test
pnpm lint:fix               # oxlint --fix
pnpm test                   # vitest run (one-shot)
pnpm test:watch             # vitest (watch mode)
pnpm test:cov               # vitest run --coverage

# Single test file
pnpm test test/tape.test.ts
# Single test by name pattern
pnpm test -t "policy"

# Logs / observability
pnpm logs:pretty                       # pino-pretty the JSONL log
phus logs --follow                     # built-in: tail structured log
phus logs --level warn --follow
phus logs --session tui:user --limit 50
```

`pnpm` is the assumed package manager (lockfile is `pnpm-lock.yaml`); the `pnpm.onlyBuiltDependencies` allowlist in `package.json` covers `better-sqlite3`, `esbuild`, `@biomejs/biome`, `koffi`, `protobufjs`, `@google/genai`.

## Architecture (big picture)

Three layers, mapped to source directories:

```
Channels  (channels/, tui/, commands/) ← I/O surface, dumb adapters
Bridge    (bridge/)                                             ← PhusAgent wraps Pi Agent
Core      (core/)                                               ← Hook / Tape / Skill / Policy / Mesh
```

**Channels** convert inbound bytes to `Envelope` and outbound `Outbound[]` to transport sends. They never see the LLM, Tape, or Skill registry directly. Built-in: `cli.ts`, `telegram.ts`, `websocket.ts`, `sse.ts`, and the pi-tui–based TUI in `packages/tui/`.

**Bridge** — `src/bridge/pi-agent.ts` — owns one Pi `Agent`, the `HookRegistry`, and runs the Bub-style turn pipeline.

**Model validation** — `src/infra/config/validate.ts` — load-time checks for every `(provider, modelId)` the config references. Profiles missing `provider` or `modelId` throw `ConfigValidationError` at load time. Pi-registry misses warn (don't throw) — custom OpenAI-compatible gateways (Volcano Ark ep-xxx, Azure deployments, vLLM) have modelIds Pi never registered. All four `getModel()` call sites in the codebase (profile.ts, model-builder.ts, pi-agent.ts setModel) funnel through `resolveAndCache()` so the lookup happens once per tuple, not once per turn.

**Provider profile schema** (current, single canonical form, no legacy translation):
```yaml
providers:
  profiles:
    smart:
      provider: anthropic         # required, Pi registry id
      modelId: Codex-sonnet-4-20250514   # required, canonical Pi id
      wireId: ${VOLCANO_WIRE_ID}  # optional, override the id sent on the wire (gateway)
      baseUrl: https://...        # optional
      apiKeyEnv: ANTHROPIC_API_KEY
      mesh:                       # optional, cross-provider failover list
        - provider: openai
          modelId: gpt-4o
          priority: 1
```
`provider` and `modelId` are required on every profile and every mesh entry. `wireId` is the explicit override for gateways (Volcano Ark's ep-xxx, Azure deployments). Profiles or mesh entries that omit `provider` or `modelId` are silently dropped at parse time; the validator surfaces a `ConfigValidationError` listing the bad ones.

```
resolve_session → admit_message → load_state → build_prompt
   → Pi Agent loop (LLM + tool calls)
     · before_tool_call (policy check, audit)
     · after_tool_call  (audit, tape write)
   → render_outbound → dispatch_outbound → save_state → tape.append(turn)
```

The public surface is `PhusAgentFacade` (interface) — channels, TUI, and CLI consume only this. Construction is explicit (every dep injected via `PhusAgentDeps`); use `createPhusAgent` in `bridge/lifecycle.ts` for the async factory + `dispose()`.

**Core** holds Phus's identity:

- `core/runtime/hook.ts` — `HookRegistry` with three modes: `first_result`, `chain`, `broadcast`. `chain` is Phus's extension over Bub. See `HookName` union in `types/hooks/index.ts` for the full list (≈17 hook points).
- `core/session/tape.ts` — SQLite-backed append-only log (WAL mode). One row per entry; kinds: `turn`, `tool_call`, `tool_result`, `anchor`, `checkpoint`, `error`.
- `core/runtime/internal-commands/` — in-process `,cmd` system (filesystem / maintenance / mesh / schedule / skills / tape). Registered via `InternalCommandRegistry`; built-ins live in `builtins/`.
- `core/llm/provider-mesh/` — `ProviderMesh` (EventEmitter) with circuit breaker, health checks, routing. Picks endpoints per turn; `mesh.call(fn)` wraps retries + failover. Endpoint specs come from `phus.config.yaml` profiles.
- `core/session/{auto-compact,checkpoint,compaction,context-select}.ts` — context window management (anchor + checkpoint pruning).
- `core/runtime/{scheduler,steering}.ts` — cron scheduler and steering inbox (interrupt mid-run, follow-up after).

**Infra** (`src/infra/`):

- `safety.ts` — operator-equivalence policy: `file_write` allowlist (roots: `./skills`, `./.phus`, `./tmp`, `./out`) + `bash` blocklist (`rm -rf /`, fork bombs, `curl|sh`, `dd if=`, `chmod -R 777 /`, `mkfs`). Runs inside `before_tool_call`, applies to every tool including meta tools.
- `skills/registry.ts` — Agent Skills–standard `SKILL.md` discovery (directory + frontmatter).
- `plugins/loader.ts` — file-based plugin discovery via `jiti` (loads TS without a build step). Plugins live in `$PHUS_HOME/plugins/<name>.ts` or `$PHUS_HOME/phus.config.yaml` under `plugins:`.
- `meta/` — meta tools the agent calls to modify itself: `skill_write`, `skill_read`, `skill_delete`, `startup_write`, `self_reflect`, `compact_session`, `tape_stats`.
- `profile.ts` — provider profile resolution (model, key, mesh).
- `retry.ts`, `drafts.ts`, `bootstrap.ts`, `logging.ts` (pino → `$PHUS_LOG_FILE`).

## Conventions worth knowing

- **Path alias**: `@/` → `src/` in both `tsconfig.json` and `vitest.config.ts`. Always import via `@/core/foo.js` style (extension included — `moduleResolution: bundler`).
- **Strict TypeScript**: `strict: true` + `noUncheckedIndexedAccess: true`. Treat index access as possibly `undefined`.
- **ESM only**: `"type": "module"`, `engines.node >= 20`. Build target `node20`.
- **Lint**: `oxlint` only (no ESLint). Categories: `correctness: error`, `suspicious: warn`, others off. The lint config relaxes rules for `test/`, `scripts/`, `deploy/`.
- **Logs**: every runtime event goes to `$PHUS_LOG_FILE` (default `./logs/phus.jsonl`) as one JSON object per line with `{ ts, level, event, sessionId?, ...fields }`. Query via `phus logs` (filter by `--event`, `--level`, `--session`).
- **Plugin CLI commands**: plugins register CLI commands via `registerCliCommand` which queues them; `src/cli/program.ts::registerPluginCliCommands` drains the queue and also fires the `register_cli_commands` hook. To add a new top-level built-in command, add a file under `src/cli/commands/` and call its `register(program)` from `cli/program.ts`.
- **Test layout**: `test/**/*.test.ts`, `environment: node`. Many tests live next to subsystems (`test/hook.test.ts`, `test/tape.test.ts`, `test/policy.test.ts`, `test/provider-mesh.test.ts`, `test/internal-commands.test.ts`, `test/tui/`).
- **TUI**: `packages/tui/` is a pi-tui app (vendored `@mariozechner/pi-tui` primitives under `packages/tui/src/vendor/pi-tui/`, no React, no ink). Slash commands live in `packages/tui/src/handler/commands/`; the input box wires `/` autocomplete via `CombinedAutocompleteProvider`. Frame layout is row-budgeted in `App.computeChatHeight()` — every component's rendered row count must match its budget or the differential repaint corrupts (measure, don't assume).
- **Sisyphus theme**: all busy/loading surfaces share one rolling-stone animation — `src/runtime/sisyphus.ts` (`SisyphusAnimator`, 150ms ticks, started on busy / stopped on idle by the App). The single busy line is `TodoPill` ("RollingLine"); the chat viewport renders content only (no spinner rows). Themed beats: streaming = "the stone rolls…", abort = "the stone slipped", quit prints "Sisyphus rests". Keep new waiting states on this system instead of inventing new spinners.
- **Busy input**: messages typed while a turn runs are queued in the App (`pendingInputs`) and flushed one-per-turn — never drop user input silently. Long-running slash handlers (`/plan create|run|resume`) must dispatch `set_busy` so the animation, the queue, and the Ctrl+C-abort path all engage.
- **Plan abort**: `PlanRunner.abort()` is cooperative — it stops the run at the next step boundary (in-flight steps can't be killed) and leaves the plan `paused` + resumable. `PhusAgent.abort()` calls both `piAgent.abort()` and `planRunner.abort()`; anything else that runs work outside the Pi loop must wire into the same path or Ctrl+C looks like a hang.
- **Durable plans**: plans are first-class persistent citizens (`plans.sqlite`), addressable across sessions by id. Two rules keep that sane: (1) NO implicit resume/create in `runPlanFlowIfRequested` — only `/plan` commands and the `plan_create`/`plan_run` meta tools drive plans, never bare messages or regex heuristics; (2) at construction, `PhusAgent.reconcileInterruptedPlans()` flips orphaned `running` rows (older than process start) to `paused`, and the TUI's startup `ResumePrompt` (Enter resume / x abandon / d dismiss) offers them explicitly. Single-writer assumption: two live processes on one PHUS_HOME will flap each other's plans.
- **No module-level state for `PhusAgent`**: lifecycle is explicit. The only module-level state is the internal-command default registry (`core/runtime/internal-commands/index.ts`) — use `_resetInternalCommands()` between tests.

## Where to look

| If you want to… | Look at |
|---|---|
| Add a CLI subcommand | `src/cli/commands/<name>.ts`, then wire in `src/cli/program.ts` |
| Add a meta tool | `src/infra/meta/{index,system-tools,skill-tools}.ts` |
| Add a hook point | extend `HookName` union in `src/types/hooks/index.ts`, fire from `bridge/pi-agent.ts` or `core/runtime/hook.ts` |
| Add a built-in `,cmd` | `src/core/runtime/internal-commands/builtins/<cluster>.ts` |
| Add a channel | implement `ChannelAdapter` in `src/channels/base.ts`; register in `src/commands/channels.ts` |
| Add a new provider endpoint | `phus.config.yaml` profile `mesh:` entries; nothing in code needed |
| Write a plugin | `documents/Plugins.md`; place under `$PHUS_HOME/plugins/` |
| Understand a subsystem | `documents/Architecture.md` is the canonical map; `documents/Phase-A.md` / `Phase-B.md` capture the build order |
| Deploy | `documents/Deployment.md` (Docker Compose, LiteLLM proxy, systemd, `phus health`) |
| Verify the self-evolution loop | `bash scripts/verify-self-evolution.sh` (requires at least one provider key) |

## Key env vars (all optional, baked-in defaults exist)

Config is **layered**: `$PHUS_HOME/phus.config.yaml` is the source of truth for paths, log, providers, plugins, schedules. A few env vars still override their YAML counterparts as deployment knobs. Secrets stay env-only.

| Var | Default | Purpose / precedence |
|---|---|---|
| `PHUS_HOME` | `./.phus` | Phus home (skills, tape, startup.sh, plugins). **Env > YAML > default.** |
| `PHUS_PROFILE` | `default` | Active provider profile name. **Env > YAML `providers.defaultProfile` > `default`.** |
| `PHUS_LOG_FILE` | `./logs/phus.jsonl` | Structured log path. **Env > YAML > default.** |
| `PHUS_LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace`. **Env > YAML > default.** |
| `PHUS_DEBUG_WIRE` | unset | When set, logs every Pi wire payload via `wire.payload`. Debug toggle, env-only. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `GROQ_API_KEY` / `MISTRAL_API_KEY` / `XAI_API_KEY` / `HF_TOKEN` / `ANTHROPIC_OAUTH_TOKEN` | — | Secrets — env-only. Pi reads these automatically; set at least one. Reference from YAML via `${OPENAI_API_KEY}` if needed. |
| `TELEGRAM_TOKEN`, `TELEGRAM_ALLOW_USERS`, `TELEGRAM_ALLOW_CHATS` | — | Gateway-only. `TELEGRAM_TOKEN` stays env-only (it's a secret). |

The unified loader lives at `src/infra/config/loader.ts::loadConfig()`. Every consumer reads from it instead of touching `process.env` directly. See `documents/Deployment.md` for the full precedence table and migration story.

## Output binary

`pnpm build` produces `dist/phus.mjs` (the `bin: phus` entry). `tsdown` externalises all `dependencies` and `node:*` built-ins; the shebang is preserved on the entry chunk. `dts: false` because rolldown-plugin-dts does not yet support TypeScript 7 — types come from the separate `tsc --emitDeclarationOnly` step in `build:types`.

## Build artifacts to ignore mentally

`dist/`, `coverage/`, `node_modules/`, `*.sqlite*` (tape DB files in repo root and `.phus/`), `logs/`, `.vscode/`. The `tape.sqlite` files at repo root come from `PHUS_TAPE_DB` defaulting to `./tape.sqlite`; `.env`-based configs normally redirect to `./.phus/tape.sqlite`.