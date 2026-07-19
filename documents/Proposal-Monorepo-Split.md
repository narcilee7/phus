# Proposal: Phus Monorepo Split & Unified App-CLI

> Companions: [`Architecture.md`](./Architecture.md), [`Intelligence-Alignment.md`](./Intelligence-Alignment.md), [`CLI-TUI-UX.md`](./CLI-TUI-UX.md), [`Release-System.md`](./Release-System.md).
>
> Goal: turn the current "one big package that is also a bin" into a small package graph where **the runtime is a library**, **the bin is one thin `phus` package**, and every other surface (TUI / GUI / Web / Mobile) is a peer app that depends on the same library set.
>
> Closes `Issues.md` items **2, 3, 4, 5** (item 1 is a separate TUI bug, owned by `@phus/tui::BootstrapWizard`).

---

## 1. Why this proposal exists

Today `packages/runtime` carries three responsibilities in one package:

1. **Library** — `PhusAgent`, channels, mesh, meta-tools (`packages/runtime/src/index.ts`).
2. **Bin composition root** — `src/phus.ts` bootstraps env → config → logger → commander → drain plugin queue (`tsdown` bundles this to `dist/phus.js`).
3. **CLI command surface** — 19 commander sub-commands under `src/cli/commands/`.

Symptoms:

| Symptom | Root cause |
|---|---|
| Issue #2 — config YAML watcher wrote to a stale per-package path | Single source of truth is missing; `runtime` is both a bin and a library, so config discovery can drift depending on which consumer runs first. |
| Issue #3 — "TUI command vs default command" duality | Today `phus` (no args) and `phus tui` are both wired to `startTui()` via two separate commander entries. The user wants neither: `phus` alone wakes the TUI, every other entry is a *command*. The bin must stop owning a `tui` subcommand. |
| Issue #4 — "split into smaller monorepo runtimes, one app CLI" | The split has not happened at the package level yet; `@phus/runtime` is monolithic, `@phus/tui` is the only peer, and `apps/gui` is segregated behind a separate lockfile because of Electron's Node 22.12 floor. |
| Issue #5 — "no release, tests still need `pnpm -C`" | `pnpm -r build` already runs, but the publish story is muddled: the bin lives in `@phus/runtime`, so the published `phus` tarball would either be too fat or strip the bin. `Release-System.md` was designed against the old single-package shape. |

The fix is not "add more scripts to `package.json`". The fix is to **carve the responsibilities into separate packages** so each one ships, tests, and releases on its own.

---

## 2. Target package graph

```
phus (monorepo)
├── apps/                         ← peer applications
│   ├── cli/                      ← the one CLI bin  (@phus/cli)           publishes as `phus`
│   ├── gui/                      ← Electron desktop                       (Node ≥22.12)
│   └── web/                      ← (future) browser host                  future
│
├── packages/                     ← pure libraries, no bin
│   ├── core/    → @phus/core     hooks · tape · skill registry · policy · plugin loader · types
│   ├── runtime/ → @phus/runtime   PhusAgent · channels · provider mesh · meta-tools · profile · safety · scheduling
│   └── tui/     → @phus/tui       terminal UI shell (vendored pi-tui)
│
└── tooling/                      ← first-party plugins / examples
    └── (none yet — reserved)
```

### Dependency direction (one-way)

```
            apps/cli ─────────────┐
            apps/gui ─────────────┤
            apps/web ─────────────┤
                                   ▼
                            packages/tui  ──→  packages/runtime  ──→  packages/core
                                                          │
                                                          └──→ (Pi family, sqlite, ws, ...)
```

Rules:

- `core` has zero deps on the LLM runner, channels, CLI, or UI. It is importable by anything that wants hooks/tape/skills without dragging Pi, mesh, or commander in.
- `runtime` depends on `core` + Pi. It owns the agent lifecycle.
- `tui` depends on `runtime` for `PhusAgent` + `infra/logging`. It owns the UI shell.
- Each `apps/*` depends on whatever libraries it needs (the GUI app depends on `runtime` but not on `cli`; the CLI app depends on `runtime` + `tui`).

No cycles. Each package has one job.

### What stays vs. moves

| Today (path inside `packages/runtime/src/`) | Tomorrow |
|---|---|
| `phus.ts` (composition root for the bin) | `apps/cli/src/main.ts` |
| `cli/program.ts` + `cli/commands/*` | `apps/cli/src/{program.ts,commands/*}` |
| `bridge/*` | `packages/runtime/src/bridge/*` |
| `channels/*` | `packages/runtime/src/channels/*` |
| `infra/{config,profile,mesh,logging,safety,retry}` | `packages/runtime/src/infra/*` |
| `infra/{skills,memory,plugins,meta}` | split: **registry / loader** → `packages/core`; **meta-tools & plugins runtime** → `packages/runtime` (see §3) |
| `core/session/{tape,checkpoint,compaction,context-select,…}` | `packages/core/src/session/*` |
| `core/runtime/{hook,plan,subagent,verifier,evolution,scheduler,steering,startup,skill,internal-commands,executor}` | `packages/core/src/runtime/*` |
| `core/llm/provider-mesh/*` | `packages/runtime/src/llm/*` (uses LLM SDK → belongs in runtime) |
| `types/**` | `packages/core/src/types/**` |
| `utils/**` | `packages/core/src/utils/**` |

After the move: `packages/runtime/src/phus.ts` is **gone**. The runtime package has no `bin`. It is a library.

---

## 3. `@phus/core` vs `@phus/runtime` — the actual split

This is where most of the design work lives. The rule:

> **`@phus/core` is importable headlessly** — no `process.stdin`, no chalk, no commander, no LLM call. Everything that satisfies that rule belongs here. Everything that doesn't, goes to `@phus/runtime`.

| Concern | Goes in | Rationale |
|---|---|---|
| `HookRegistry` (`first_result` / `chain` / `broadcast`) | core | pure orchestrator |
| `HookName` union, `HookCtx` | core | types, no I/O |
| `Tape` (SQLite-backed) | core | the only `node:fs` / sqlite use case in core |
| `SkillRegistry` (Agent Skills standard) | core | filesystem scan only; no LLM |
| Plugin loader (`jiti`) | core | files + ts compiler; no LLM |
| `Policy` (allowlists / blocklists) | core | pure decision |
| Session primitives (`checkpoint`, `compaction`, `context-select`, `plan-store`, `repo-file-index`, `auto-compact`) | core | they read/write tape; nothing else |
| Plan runner, subagent, verifier, executor | core | they call hooks, write tape, **they do not call LLM directly** — they call `runtime` through an injected port |
| Evolution engine, learner, skill validator | core | same as above |
| Scheduler, steering, `startup.sh` | core | filesystem + cron-parser |
| Internal command registry | core | command shape is pure; the command **implementations** that need LLM stay in runtime |
| Logger (`pino` wrapper) | core | logging is side-effect-free except for the file sink; the file sink stays here (debug-style usage from plugins) |
| Types, utils | core | obviously |
| `PhusAgent` class | **runtime** | owns the Pi `Agent`, calls LLM |
| `transformContext`, `beforeToolCall`, `afterToolCall` (the bridge to Pi) | **runtime** | LLM-loop-aware |
| Prompt assembly (memory + skills + tape summary) | **runtime** | depends on profile + mesh |
| Provider profile + mesh + fuse + retry | **runtime** | uses `pi-ai`, talks to APIs |
| Meta-tools (`skill_write`, `startup_write`, `self_reflect`, `memory_*`, `compact_session`, `tape_stats`, evolution-tools, plan-tools) | **runtime** | they ultimately call `PhusAgent` / `Tape`; their file-write paths use policy |
| `safety` (file-write allowlist, bash blocklist) | **runtime** | enforced at the tool-call layer; rule lives near the executor |
| Channels (`cli`, `telegram`, `websocket`, `sse`, `slack`, `email`, `whatsapp`) | **runtime** | I/O, transport-specific |
| Internal-command **implementations** that need LLM (`auto`, `mesh`, `skills`, `tape`, etc.) | **runtime** | `registry` in core, `impl/` in runtime |

`@phus/runtime` becomes: `core` + `pi-agent-core` + `pi-ai` + channels + meta-tools + provider mesh. Its top-level barrel:

```ts
// packages/runtime/src/index.ts
export { PhusAgent, type PhusAgentDeps, type PhusAgentFacade } from "@/bridge/pi-agent.js";
export { loadConfig, resetConfigCache } from "@/infra/config/index.js";
export { resolveProfile, type ProviderProfile } from "@/infra/profile.js";
export { logger } from "@/infra/logging.js";
export type { ResolvedConfig } from "@/infra/config/schema.js";
export { type ChannelAdapter, registerChannel } from "@/channels/index.js";
```

---

## 4. The unified `@phus/cli` (the one `phus` bin)

`apps/cli/` is the only package with a `bin` field. The npm name is `@phus/cli`; the installed command is `phus`.

### 4.1 One default, all else are commands

The CLI surface is intentionally minimal:

```
phus                       → wake TUI
phus <command> [args...]   → run that command
```

That's the whole grammar. There is **no `phus tui`** — the binary has exactly one implicit default (the TUI), and every other behavior is a subcommand. `chat`, `run`, and `gateway` are commands too — just long-running ones. `--help` lists every command; the TUI is the fallback when none is given.

```bash
$ phus
# …TUI mounts, the session you already know…

$ phus chat
# …headless REPL session…

$ phus run "summarize this repo"
# …one-shot prompt, exits 0 or 1…

$ phus gateway --telegram
# …long-lived daemon…

$ phus setup
$ phus health
$ phus logs --follow
# …diagnostic one-shots…
```

This shape matters for two reasons. First, `apps/gui` and (future) `apps/web` borrow any subset of the **commands** without inheriting the TUI mode wiring — they have their own entry points and never need to know about `@phus/cli`. Second, `phus tui` is deliberately *not* an alias: if a user types it, they get a usage error, which prevents the duality that Issue #3 was complaining about.

### 4.2 Argument model

```
phus                       → startTui()
phus <command> [...]       → runCommand("<command>", argv)
phus --help                → commander help
phus --version             → commander version
```

`apps/cli/src/main.ts` (the composition root):

```ts
import { loadEnvFile } from "@phus/runtime";
import { loadConfig, setLogSink, initLogger, logger } from "@phus/runtime";
import { buildProgram } from "./program.js";
import { startTui } from "@phus/tui";
import { runCommand } from "./commands/index.js";

loadEnvFile();
const config = loadConfig({ warn: (e, f) => logger.warn(e, f) });
setLogSink((e, f) => logger.warn(e, f));
initLogger({ file: config.log.file, level: config.log.level });

const program = buildProgram();
await drainPluginCommands(program, config);

// No subcommand matched → wake TUI. Commander fires the registered
// `action` once argv is parsed and lets us fall through here when the
// user passed no command name.
const argv = process.argv.slice(2);
const hasKnownCommand = argv.length > 0 && program.commands.some(
  (c) => c.name() === argv[0] || c.aliases().includes(argv[0]!),
);
if (!hasKnownCommand) {
  await startTui();
} else {
  await program.parseAsync(process.argv);
}
```

```ts
// apps/cli/src/commands/index.ts
export async function runCommand(name: string, argv: string[]): Promise<never> {
  const handler = handlers[name];
  if (!handler) {
    console.error(`[phus] unknown command: ${name}`);
    process.exit(2);
  }
  await handler(argv);
  process.exit(0);
}
```

### 4.3 What gets deleted

- `packages/runtime/src/cli/commands/default.ts` — removed. The "no subcommand → TUI" behavior moves to `apps/cli/src/main.ts`'s fall-through.
- `packages/runtime/src/cli/commands/tui.ts` — removed. There is no `phus tui` in the surface. If a user types it, commander prints `unknown command 'tui'`.
- `tsdown.config.ts` inside `packages/runtime` — removed. `apps/cli` gets its own bundle config (shebang banner preserved on `cli.js`).

This is the surgical answer to Issue #3: one binary, one implicit default, every other behavior is a named command. No aliases, no dual wiring.

---

## 5. Issue-by-issue mapping

| Issue | Owner after split | Resolution |
|---|---|---|
| **#1** Bootstrap paste doesn't work | `@phus/tui` (`components/wizard/BootstrapWizard.tsx`, `KeyWizard.tsx`) | TUI bug, not a package-shape issue. Owned by the TUI package; tracked separately. **Out of scope for this proposal** but called out so it doesn't get dropped. |
| **#2** Config YAML watch path broken after monorepo migration | `@phus/cli` (`apps/cli/src/main.ts`) + `@phus/runtime` config loader | After the split, the config loader is the **only** owner of `configPath()` and chokidar. `apps/gui` and `apps/web` will call `loadConfig()` without re-implementing watch. The watcher can be centralized and path-tested. Today the duplication lives in `runtime` + the post-TUI-bootstrap reload — collocation fixes it. |
| **#3** CLI is TUI, TUI is CLI | `@phus/cli` (`apps/cli/src/main.ts`) | `phus` (no args) → `startTui()`. The `tui` subcommand is deleted; typing `phus tui` is a usage error. Every other surface (`chat`, `run`, `gateway`, `setup`, `health`, …) is a registered command. |
| **#4** Split runtime, one app CLI, future web/gui/mobile | All of this doc | The proposal. Once executed, `apps/gui` is a peer of `apps/cli` and depends on `@phus/runtime` directly (no CLI detour). Future `apps/web` and `apps/mobile` follow the same shape. |
| **#5** No release, tests need `cd packages/tui` | `@phus/cli` package + new CI matrix (see §6) | Re-enable `apps/*` in `pnpm-workspace.yaml` once Node ≥22.12 is required at the repo level (or keep the per-app `engines.node` carve-out via `package.json` overrides). Add `release.yml` matrix: build `@phus/cli` → npm; build `@phus/runtime`, `@phus/core`, `@phus/tui` only for provenance (pre-release). CI runs the whole `pnpm -r test` matrix from the root, so `cd packages/tui` goes away. |

---

## 6. CI / Release pipeline after the split

### 6.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`apps/gui` is now first-class. The Electron floor (Node ≥22.12) is declared in its own `package.json#engines`, and the root CI matrix uses `actions/setup-node@v4` with `node-version-file: .nvmrc` per job. A single `.nvmrc` at the repo root pins the lowest common version (`20`) and `apps/gui` adds a Node-version override at the workflow step level.

### 6.2 `.github/workflows/ci.yml`

```yaml
strategy:
  matrix:
    pkg:
      - core
      - runtime
      - tui
      - cli
      - gui
    node: [20, 22]   # gui runs only on 22
    include:
      - pkg: gui
        node: 22
steps:
  - uses: pnpm/action-setup@v4
  - run: pnpm install --frozen-lockfile
  - run: pnpm --filter @phus/${{ matrix.pkg }} typecheck
  - run: pnpm --filter @phus/${{ matrix.pkg }} lint
  - run: pnpm --filter @phus/${{ matrix.pkg }} test
  - run: pnpm --filter @phus/${{ matrix.pkg }} build
```

Tests run from the repo root with `pnpm --filter`. The `cd packages/tui` incantation disappears.

### 6.3 `.github/workflows/release.yml`

Publishable surface:

| Package | npm dist-tag | Docker tag |
|---|---|---|
| `@phus/cli` (the only bin) | `latest` (stable) / `beta` / `alpha` | `ghcr.io/phus/phus:<v>` |
| `@phus/runtime` | not published separately in v1 (consumed via `cli`) | n/a |
| `@phus/core` | not published separately in v1 | n/a |
| `@phus/tui` | not published separately in v1 | n/a |
| `@phus/gui` | not npm; released as Electron app via `electron-builder` to GH Releases | `ghcr.io/phus/phus-gui:<v>` (optional) |

Rationale: in v1 we keep only **one npm bin**. Library packages stay private to the workspace and move to npm only when an external consumer appears. This matches the Release-System.md intent without multiplying publish targets.

### 6.4 `scripts/release.sh` change

Today it bumps root `package.json` version. After split, it bumps `@phus/cli` version (the only published bin) and rewrites the `engines` floor if necessary. A single tag, one release entry.

---

## 7. Migration sequence (the part that matters)

I would **not** ship this as one PR. The order matters because each step keeps the repo green:

### Stage 0 — branch + bookkeeping (no behavior change)
1. Branch: `refactor/monorepo-split` from `chore/clear-ai-code`.
2. Add empty `apps/cli`, `packages/core` directories with stub `package.json`.
3. Update `pnpm-workspace.yaml` to include `apps/*` (after `apps/gui`'s own `package.json` is moved in / created).
4. Make `@phus/runtime` a peer of nothing (still depends only on Pi).

### Stage 1 — extract `@phus/core`
1. Move `core/`, `types/`, `utils/`, plus `infra/{skills,memory,plugins,bootstrap,drafts,env-file,logging,safety,retry,session}` inside (deciding each per §3 table) into `packages/core/src/`.
2. Re-export the public surface from `packages/core/src/index.ts`.
3. Make `@phus/runtime` depend on `@phus/core` and re-export the same names from its barrel for now (no breakage).
4. All existing tests pass; `pnpm typecheck` green.

### Stage 2 — extract the bin to `@phus/cli`
1. Create `apps/cli/`. Move `cli/program.ts`, `cli/commands/*`, and `phus.ts` here.
2. Add `bin: { phus: "./dist/cli.js" }` to `apps/cli/package.json`.
3. Keep root `package.json`'s `pnpm dev` working by pointing at `apps/cli` — this is the **only** behavior change visible to the user, and it's invisible (the same `pnpm dev` launches the same binary).
4. Cut `tsdown` from `packages/runtime`; clone the config to `apps/cli`.
5. Delete `packages/runtime/src/cli/` and `packages/runtime/src/phus.ts`.
6. Add `pnpm -r build` matrix entry for `@phus/cli`.

### Stage 3 — drop the `tui` subcommand; one default, the rest are commands
1. Move `apps/cli/src/main.ts` to fall through to `startTui()` when no known subcommand is given. No `phus tui` in the registered command set.
2. Delete `packages/runtime/src/cli/commands/default.ts` and `packages/runtime/src/cli/commands/tui.ts`.
3. Verify: `phus` → TUI; `phus tui` → usage error; `phus <anything-else>` → registered command.
4. **Issue #3 closed.**

### Stage 4 — `apps/gui` re-onboarding
1. Create `apps/gui/` (Electron host). It depends on `@phus/runtime` + `@phus/core`. It does **not** depend on `@phus/cli`.
2. The GUI's bootstrap flow uses `loadConfig()` from `@phus/runtime`, *not* a local re-implementation.
3. `pnpm-workspace.yaml` re-enabled; `cd apps/gui` works the same way as `cd packages/runtime` does today.

### Stage 5 — release pipeline
1. Add `apps/cli` to `release.yml`. Single bin, single tag, single npm publish.
2. Cut the v0.1.0 tag. `release.sh` writes the changelog and bumps `@phus/cli`.
3. **Issue #5 closed.**

### Stage 6 — future
- `apps/web` is a Next.js or Hono SPA that uses `@phus/runtime` over its own RPC surface (HTTP / WebSocket channel — already supported by `channels/websocket.ts` and `channels/sse.ts`).
- `apps/mobile` is a React Native wrapper around the same RPC.

These do not require new packages inside `packages/`. They consume the library surface as written.

---

## 8. Acceptance criteria

For Issues.md, after Stage 5 ships:

- [ ] `pnpm dev` (root) launches the TUI via `@phus/cli`; no `tsx packages/runtime/src/phus.ts` in any script.
- [ ] `pnpm test` (root) runs every package's tests via `pnpm -r`; no `cd packages/<name>` needed.
- [ ] `pnpm build` (root) builds every package including `@phus/cli`.
- [ ] `phus` (no args) opens the TUI; `phus tui` is not a recognized command (commander prints `unknown command 'tui'` and exits non-zero).
- [ ] `phus chat`, `phus run`, `phus gateway`, `phus setup`, `phus health` each route through their registered handler.
- [ ] `pnpm release patch` bumps `@phus/cli` and pushes a tag; CI publishes the npm tarball + Docker image.
- [ ] `apps/gui` `package.json#engines.node = ">=22.12"` and CI matrix skips GUI on Node 20.
- [ ] `@phus/runtime` `package.json` has **no** `bin` field.
- [ ] `@phus/runtime` and `@phus/core` and `@phus/tui` are marked `private: true` (workspace-only) for v1.
- [ ] `Issues.md` items 2, 3, 4, 5 crossed off. Item 1 still tracked under TUI ownership.

For the Intelligence vision (north star), the split is purely structural — no behavior change is forced. But it enables the Phase A / B / C / D workstreams because now `@phus/core` is the right place to land Memory OS without dragging `@phus/runtime` along.

---

## 9. Non-goals (called out to prevent scope creep)

- We do not rename `@phus/runtime` to something else in v1. (`@phus/agent` is tempting; leave it.)
- We do not split `@phus/core` into smaller packages (e.g. `@phus/tape`, `@phus/hooks`). One core, room to grow.
- We do not introduce a new monorepo tool (Nx, Turborepo). `pnpm` already filters; matrix CI is enough for now.
- We do not move `@phus/tui` away from the vendored pi-tui shim in this workstream. That's its own proposal.
- We do not change the `phus <subcommand>` UX beyond merging `default` + `tui`. Commander semantics stay; only the wiring collapses.

---

## 10. Open questions for sign-off

1. **Library package privacy.** Should `@phus/core`, `@phus/runtime`, `@phus/tui` be `private: true` for v1 (consumed via workspace only), or published alongside `@phus/cli` so plugin authors can `import { PhusAgent } from "@phus/runtime"` from day one? Recommendation: keep them **private** until external consumers appear; the workspace `exports` map already gives plugin authors access via `@phus/runtime/bridge/...` paths.
2. **App CLI package name.** `@phus/cli` (proposal) vs `@phus/app` vs letting `@phus/runtime` *keep* the bin. Recommendation: `@phus/cli`. `@phus/runtime` should be library-only; mixing types blurs the boundary.
3. **Bin shim during Stage 0/1/2.** Add a `bin` stub at `packages/runtime/src/cli.ts` that re-exports `apps/cli/src/main.ts` so the npm tarball shape doesn't change mid-migration? Or hard-cut from v0.1.0 → v0.2.0? Recommendation: hard-cut at a minor bump; the install script downloads a pre-built tarball anyway, so consumers see one coherent upgrade.
4. **Versioning policy.** Each package gets its own semver? Or one version bumps all? Recommendation: **fixed** semver across the workspace in v1 (one tag, one version). Independently versioned packages is a Phase 5+ conversation.

Once these four are settled, Stage 0 takes a single PR.
