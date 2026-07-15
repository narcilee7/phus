# Phus

⛰️  Self-evolving agent. Push the stone up the mountain.

Named after Sisyphus — every turn repeats, every turn grows. Phus is a small Node runtime that wraps [@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core) with a [Bub](https://github.com/bubbuild/bub)-style hook layer, a SQLite tape for context, and an Agent Skills–compatible skill registry. The agent can write new skills to disk at runtime, edit its own startup script, and reflect on its past turns.

```
Channel (CLI / Telegram / WS / SSE / TUI)
       │
       ▼
  PhusAgent.turn()
       │
       ├─ Hook chain  (resolve_session → load_state → build_prompt)
       ├─ Pi Agent    (LLM loop, skills + tape injected via transformContext)
       │     └─ Tool calls → Tape (before_tool_call / after_tool_call)
       │                   └─ Policy check (operator-equivalence allowlist)
       ├─ render_outbound → dispatch_outbound
       └─ save_state → Tape
```

See [`documents/Architecture.md`](documents/Architecture.md) for the design vision, layered architecture, and what we took from Bub / Pi / OpenClaw.

---

## Install

```bash
npm install
cp .env.example .env
# fill in at least one provider key
```

## Quick start

```bash
# Interactive TUI (default — `phus` with no args)
phus

# One-shot prompt
phus run "summarize this repo"

# Multi-channel gateway (24/7 service mode)
phus gateway --websocket 8080
```

The first time you run it, Phus creates `./skills/`, `./.phus/`, and `./logs/` automatically. Read [`documents/Architecture.md`](documents/Architecture.md) to understand how it all fits together.

---

## Commands

| Command | Purpose |
|---|---|
| `phus` | Launch the interactive **ink TUI** (default) |
| `phus chat` / `phus tui` | Aliases for the default TUI |
| `phus run "<prompt>"` | One-shot execution, prints response, exits |
| `phus gateway [--websocket N] [--telegram] [--sse N]` | Start channel listeners in foreground |
| `phus hooks` | List registered hooks (diagnostic) |
| `phus skills` | List discovered skills |
| `phus tape` | Print tape statistics |
| `phus policy` | Print active safety policy |
| `phus plugins-list` | List loaded plugins |
| `phus trace <sessionId>` | Print a turn timeline for one session |
| `phus logs [--follow] [--session S] [--level L]` | Query the structured JSON log |
| `phus compact <sessionId>` | Summarize old turns into an anchor |
| `phus health` | Health check (used by Docker / systemd) |

Run `phus help <command>` for options on any command.

---

## Configuration

All configuration is via environment variables (or `.env`):

| Env | Default | Purpose |
|---|---|---|
| `PHUS_MODEL` | `anthropic/claude-sonnet-4-20250514` | `<provider>/<modelId>` (uses Pi's getModel) |
| `PHUS_HOME` | `./.phus` | Phus home (skills, tape, startup.sh, plugins) |
| `PHUS_TAPE_DB` | `./.phus/tape.sqlite` | SQLite tape path |
| `PHUS_SKILLS_DIR` | `./skills` | Skills directory (Agent Skills standard) |
| `PHUS_LOG_FILE` | `./logs/phus.jsonl` | Structured log path |
| `PHUS_LOG_LEVEL` | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` | — | Pi reads these automatically |

Provider key wins: set any one and Phus works. For OpenRouter access to DeepSeek: `OPENROUTER_API_KEY=sk-or-...` and `PHUS_MODEL=openrouter/deepseek/deepseek-chat-v3`.

---

## Observability

All runtime events go to `./logs/phus.jsonl` as one JSON object per line. Tail it with:

```bash
phus logs --follow                          # stream everything
phus logs --level warn --follow            # only warnings and above
phus logs --session tui:user --limit 50    # one session
phus logs --event tool.blocked_by_policy    # one event type
```

Notable events: `turn.completed`, `tool.call`, `tool.blocked_by_policy`, `compaction.completed`, `plugin.loaded`, `gateway.started`, `gateway.shutdown`, `startup.found`, `skill.invalid_frontmatter`.

Each line carries `ts`, `level`, `event`, `sessionId` (when applicable), and arbitrary fields. `phus logs --json` outputs the raw JSON for piping into `jq`.

---

## Safety

Operator equivalence (Bub principle): the agent cannot write outside `./skills/`, `./.phus/`, `./tmp/`, `./out/`, and its `bash` tool is blocked against `rm -rf /`, fork bombs, `curl|sh`, `dd if=`, `chmod -R 777 /`, and `mkfs`. These rules live in [`src/core/policy.ts`](src/core/policy.ts) and run inside the `before_tool_call` hook — they apply to every tool call, including meta tools, and cannot be bypassed by the agent. See `phus policy` for the active rule set.

---

## Plugins

Plugins let you extend Phus without forking. They can register hooks, skills, and channels. See [`documents/Plugins.md`](documents/Plugins.md) for the full guide.

```typescript
// ~/.phus/plugins/greet-everyone.ts
import type { Plugin } from "phus";

export default {
  name: "greet-everyone",
  register(ctx) {
    ctx.hooks.register("resolve_session", async (c) => `greet:${c.envelope?.from ?? "anon"}`, {
      mode: "first_result",
      priority: 100,
    });
  },
} satisfies Plugin;
```

## Deployment

For 24/7 operation, see [`documents/Deployment.md`](documents/Deployment.md). Quick version:

```bash
docker compose up -d         # gateway mode, WebSocket on :8080
sudo systemctl enable --now phus   # or systemd
```

The `phus health` command is used by both Docker HEALTHCHECK and systemd watchdog.

---

## Self-evolution

The agent can call `skill_write`, `startup_write`, `self_reflect`, `compact_session`, and `tape_stats` as built-in meta tools. This is the loop:

```
user → PhusAgent → Pi Agent loop
                     ├─ tool: skill_write       → writes ./.phus/skills/<name>/SKILL.md
                     ├─ tool: startup_write     → writes ./.phus/startup.sh (runs on next gateway boot)
                     ├─ tool: self_reflect      → reads past turns from tape
                     └─ tool: compact_session   → summarizes old turns
```

Verify it works end-to-end:

```bash
bash scripts/verify-self-evolution.sh
```

Requires at least one provider key set.

---

## Architecture deep dive

- [`documents/Architecture.md`](documents/Architecture.md) — How each Phus piece maps to Bub and Pi
- [`documents/Plan-correction.md`](documents/Plan-correction.md) — Design rationale + corrections to the original Plan.md
- [`documents/Plugins.md`](documents/Plugins.md) — Plugin development guide
- [`documents/Deployment.md`](documents/Deployment.md) — Docker + systemd deployment

## License

MIT
