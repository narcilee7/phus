# Phus

⛰️  Self-evolving agent. Push the stone up the mountain.

Named after Sisyphus — every turn repeats, every turn grows.

## What it is

Phus is a small Node runtime that wraps [@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core) (Pi) with a Bub-style hook layer, a SQLite tape for context, and an Agent Skills-compatible skill registry. The agent can write new skills to disk at runtime, edit its own startup script, and reflect on its past turns.

## Install

```bash
npm install
cp .env.example .env
# fill in API keys
```

## Commands

```bash
npx phus run "summarize this repo"      # one-shot
npx phus chat                            # interactive REPL
npx phus gateway --websocket 8080        # multi-channel gateway
npx phus hooks                           # diagnostic: list hooks
npx phus skills                          # list discovered skills
npx phus tape                            # tape stats
```

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PHUS_MODEL` | `anthropic/claude-sonnet-4-20250514` | `<provider>/<modelId>` (uses Pi's getModel) |
| `PHUS_HOME` | `./.phus` | Phus home dir (skills, tape, startup.sh) |
| `PHUS_TAPE_DB` | `./tape.sqlite` | SQLite tape path |
| `PHUS_SKILLS_DIR` | `./skills` | Skills directory |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / ... | — | Pi reads these automatically |

## Architecture

See `docs/Plan-correction.md` for the full design rationale.

```
Channel Adapter (cli / telegram / ws / sse)
       │
       ▼
  PhusAgent.turn()
       │
       ├─ Hook chain (resolve_session → load_state → build_prompt)
       ├─ Pi Agent (LLM loop with skills + tape injected via transformContext)
       │     └─ Tool calls → Tape (before_tool_call / after_tool_call)
       ├─ render_outbound → dispatch_outbound
       └─ save_state → Tape
```

## License

MIT
