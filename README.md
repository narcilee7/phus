# ⛰️ Phus

<p align="center">
  <strong>Self-evolving agent runtime — every turn repeats, every turn grows.</strong>
</p>

<p align="center">
  <a href="https://github.com/narcilee7/phus/releases/latest"><img src="https://img.shields.io/github/v/release/narcilee7/phus" alt="CLI Version" align="middle"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" align="middle"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node ≥20" align="middle">
  <img src="https://img.shields.io/badge/pnpm-10%2B-orange" alt="pnpm 10+" align="middle">
  <a href="README-CN.md"><img src="https://img.shields.io/badge/docs-中文-red" alt="中文文档" align="middle"></a>
</p>

---

Phus is a TypeScript monorepo agent runtime. It wraps [@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core) (LLM loop + tools) with a [Bub](https://github.com/bubbuild/bub)-style hook chain, a SQLite-backed Tape for persistent context, an [Agent Skills](https://agentskills.io)–compatible skill registry, and a self-evolution loop. It runs as a CLI, a TUI, or a multi-channel gateway — same agent, same tools, same safety rules.

## Why Phus?

Most agent frameworks stop at "LLM + tools". Phus adds what a long-running agent actually needs:

### Planner + SubAgent (execution)

The agent creates and runs **multi-step plans** with DAG-based step scheduling. Steps within the same topological level run in **parallel** (capped at 3 sub-agents) — and each step runs in its own **isolated SubAgent** with a private message history that never leaks into the parent. The Planner decomposes a goal into steps, the DAG scheduler levels them, and sub-agents execute with wall-clock timeout + cooperative abort.

```
Goal → Planner → [inspect] → [edit, test] (parallel) → [repair] → done
                      │            │
                      └─ SubAgent ─┘  (fresh Agent, private messages)
```

Plans survive restarts (SQLite-backed), support replan on failure, and expose `plan_create` / `plan_run` / `plan_status` as **meta tools the agent itself can call**.

### Self-evolution loop

The agent doesn't just use skills — it **writes them**. 14 meta tools let it modify itself at runtime:

| Category          | Tools                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Skills**        | `skill_write` — create new capabilities from experience (Markdown prompt guides, not code)     |
|                   | `skill_read` / `skill_delete` — inspect or remove skills                                       |
|                   | `skill_validate` — A/B test a skill draft vs baseline, auto-promote if better                  |
| **System**        | `startup_write` — write boot scripts (runs on next gateway start)                              |
|                   | `startup_suggest` — analyze tape + plans, suggest startup additions                            |
|                   | `self_reflect` — read past turns across sessions                                               |
|                   | `compact_session` — summarize old turns to free context window                                 |
| **Memory**        | `memory_read` / `memory_write` — maintain `phus.md` cross-session project memory               |
| **Evolution**     | `reflect` — analyze a session, extract what worked/failed, suggest reusable procedures         |
|                   | `plan_create` / `plan_run` / `plan_status` / `plan_list` — create and execute multi-step plans |
| **Introspection** | `tape_stats` — per-session aggregate counts                                                    |

The Evolution Engine runs after every completed plan: it reflects on the outcome, writes skill drafts from reusable procedures, and validates them against baselines — closing the loop from _experience → skill → verified improvement_.

### External tools

The agent interacts with the real world through 6 non-negotiable tools:

| Tool         | Purpose                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `bash`       | Shell commands via `child_process`, with timeout + abort signal + retry            |
| `file_read`  | Read files with line numbers, paging, byte cap                                     |
| `file_write` | Write/overwrite files, auto-create parent directories                              |
| `edit`       | String-replace file edits (first-match or replace-all, with uniqueness check)      |
| `grep`       | ripgrep search with regex, glob filtering, context lines, sensitive-file filtering |
| `glob`       | File discovery with brace expansion, sorted by mtime                               |

### Safety by design

Operator equivalence — the agent and you share the same boundary:

- `file_write` restricted to `./skills/`, `./.phus/`, `./tmp/`, `./out/`
- `bash` blocks `rm -rf /`, fork bombs, `curl|sh`, `dd if=`, `chmod -R 777 /`, `mkfs`
- Policy enforced at `before_tool_call` — applies to **every** tool, including meta tools, across **every** channel
- SubAgents inherit the same tool list and safety rules — no escape hatch

## Install

Choose one of the following.

### Homebrew (macOS / Linux)

```bash
brew tap narcilee7/phus https://github.com/narcilee7/phus.git
brew install phus
phus --version
```

### npm

```bash
npm install -g @phus/cli
phus --version
```

### GitHub Release

Download the latest archive from [GitHub Releases](https://github.com/narcilee7/phus/releases), extract it, and run:

```bash
tar -xzf phus-<version>.tar.gz
./phus-<version>/bin/phus --version
```

### Build from source

```bash
git clone https://github.com/narcilee7/phus.git
cd phus
pnpm install
pnpm build
./apps/cli/dist/phus.mjs --version
```

## Quick start

```bash
# Prerequisites: Node ≥20, pnpm ≥10
pnpm install

# Set at least one API key
export ANTHROPIC_API_KEY=sk-ant-...
# or: OPENAI_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY

# Launch the TUI (default)
pnpm dev

# One-shot prompt
pnpm run "summarize this repo"

# Gateway mode (WebSocket + SSE)
pnpm gateway --websocket 8080 --sse 8081
```

Run `phus setup` for an interactive configuration wizard that writes `phus.config.yaml`.

## Architecture

```
Channel (CLI / TUI / WebSocket / SSE / Telegram / Slack / Email / WhatsApp)
  │
  ▼
resolve_session → load_state → build_prompt → Pi Agent (LLM + tools)
                                                  │
                              ┌───────────────────┘
                              ▼
                        before_tool_call → policy check
                        tool execution (bash, file, meta, …)
                        after_tool_call  → Tape
                              │
                              ▼
                        render_outbound → dispatch_outbound → save_state → Tape
```

Every turn is append-only to SQLite Tape. Skills + memory + relevant history are injected into the LLM context. The hook chain (7 stages, 17+ hook points) lets plugins intercept every stage.

## Packages

```
apps/cli/            @phus/cli         — the `phus` binary
packages/tui/        @phus/tui         — terminal UI (pi-tui primitives)
packages/runtime/    @phus/runtime     — PhusAgent, bridge, channels, meta tools, provider mesh
packages/core/       @phus/core        — hook, tape, skill registry, policy, types
packages/shared/     @phus/shared      — protocol types and utilities
```

Dependency direction (one-way, no cycles):

```
apps/cli → packages/tui → packages/runtime → packages/core → packages/shared
```

## Configuration

Configuration lives in `phus.config.yaml` (generated by `phus setup`). Key environment variables:

| Env              | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `PHUS_HOME`      | Home directory (skills, tape, startup.sh). Default `./.phus` |
| `PHUS_LOG_FILE`  | Structured JSONL log path. Default `./logs/phus.jsonl`       |
| `PHUS_LOG_LEVEL` | `fatal` / `error` / `warn` / `info` / `debug` / `trace`      |
| `PHUS_PROFILE`   | Active provider profile                                      |

Provider keys are read automatically by Pi. See [`phus.config.example.yaml`](phus.config.example.yaml) for the full schema (provider mesh with circuit breakers, schedules, channels, plugins).

## Plugins & extensibility

Plugins are TypeScript files loaded via `jiti` — no build step. Register hooks, skills, and channels:

```typescript
// ~/.phus/plugins/greet-everyone.ts
import type { Plugin } from "@phus/runtime";

export default {
  name: "greet-everyone",
  register(ctx) {
    ctx.hooks.register(
      "resolve_session",
      async (c) => `greet:${c.envelope?.from ?? "anon"}`,
      {
        mode: "first_result",
        priority: 100,
      },
    );
  },
} satisfies Plugin;
```

See [`documents/Plugins.md`](documents/Plugins.md).

## Deployment

```bash
docker compose up -d                  # gateway mode, WebSocket on :8080
sudo systemctl enable --now phus      # systemd service
```

`phus health` for HEALTHCHECK / watchdog. See [`documents/Deployment.md`](documents/Deployment.md).

## Further reading

- [`documents/Architecture.md`](documents/Architecture.md) — design vision, layered architecture, inspirations (Bub / Pi / OpenClaw)
- [`documents/Plugins.md`](documents/Plugins.md) — plugin development guide
- [`documents/Deployment.md`](documents/Deployment.md) — Docker + systemd
- [`documents/Release-System.md`](documents/Release-System.md) — release pipeline
- [`documents/TUI-Shortcuts.md`](documents/TUI-Shortcuts.md) — keyboard shortcuts
- [`CHANGELOG.md`](CHANGELOG.md) — release history

## License

MIT © 2026 NarciLee
