# Architecture

> Phus's design vision, layered architecture, and the three projects that shaped it.

---

## 1. Vision

### The Sisyphus metaphor

Phus is named after Sisyphus. Every turn of the agent is one push of the stone:

- The **inbound message** is the bottom of the hill.
- The **hook chain** is the slope.
- The **outbound reply** is the top.
- The **Tape entry** is the impression the stone leaves in the dirt.
- The **next turn** starts from where the last one stopped.

The system is built around a single principle: **repetition with growth**. Every push looks the same from the outside, but the agent accumulates skills, memories, and self-modifications along the way. The stone never gets lighter — but the hill does.

### What Phus is for

Phus is for **long-running personal agents that share your environment**. Not demos, not benchmarks — actual agents that:

1. Sit in your group chat, your CLI, your Telegram, your IDE.
2. Accumulate state across sessions (Tape) and across capabilities (Skills).
3. Modify themselves when they need a new capability (skill_write, startup_write).
4. Respect the same boundaries you do (operator equivalence: same hooks, same allowlists, same audit trail).

### What Phus is not

- Not a workflow engine. Phus doesn't model DAGs or trigger pipelines — it just answers turns.
- Not a framework for building agents from scratch. Phus is the runtime; the agent's "brain" is delegated to Pi (LLM + tool loop).
- Not a single-channel product. Channels are pluggable; the agent is channel-agnostic.

---

## 2. Architecture design

### Three layers

```
┌──────────────────────────────────────────────────────────┐
│  Channels       CLI · TUI · Telegram · WebSocket · SSE   │  ← I/O surface
├──────────────────────────────────────────────────────────┤
│  Bridge         PhusAgent → Pi Agent (LLM + tool loop)   │  ← engine
├──────────────────────────────────────────────────────────┤
│  Core           Hook · Tape · Skill · Policy · Plugin    │  ← orchestration
└──────────────────────────────────────────────────────────┘
```

**Channels** are dumb adapters. They convert inbound bytes into `Envelope` and outbound `Outbound[]` into transport-specific sends. They never see the LLM, the Tape, or the Skill registry directly.

**Bridge** wraps [pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core). `PhusAgent` owns one Pi `Agent` and two callbacks:
- `transformContext` — injects skills + tape summary + system prompt into every LLM call
- `beforeToolCall` / `afterToolCall` — runs the policy check and writes audit entries

**Core** is where Phus's identity lives:
- **HookRegistry** — Bub-style hook chain (firstresult / chain / broadcast)
- **Tape** — SQLite-backed append-only log, one row per kind (turn / tool_call / tool_result / anchor / error)
- **SkillRegistry** — Agent Skills standard `SKILL.md` discovery
- **Policy** — operator-equivalence allowlist (file_write roots, bash blocklist)
- **Plugin loader** — file-based discovery via `jiti`
- **Meta tools** — the agent's self-modification API

### The turn pipeline

Every inbound message walks the same path (Bub's `process_inbound`):

```
Channel → Envelope
       │
       ▼
  resolve_session     (firstresult hook)
       │
       ▼
  load_state          (broadcast hook)
       │
       ▼
  build_prompt        (firstresult hook)
       │
       ▼
  Pi Agent loop       (LLM + tool calls, transformContext injects skills+tape)
       │
       ├─ before_tool_call  → policy check → block or proceed
       ├─ tool execution    → external or meta tool
       └─ after_tool_call   → write tool_result to Tape
       │
       ▼
  render_outbound     (broadcast hook, merge into final list)
       │
       ▼
  dispatch_outbound   (broadcast hook, send via channel)
       │
       ▼
  save_state          (broadcast hook)
       │
       ▼
  append turn         → Tape
```

The same shape handles one message in CLI mode, a stream of messages in gateway mode, and a multi-session TUI.

### Self-evolution loop

The agent can modify itself at runtime via meta tools:

| Tool | Writes to | Effect |
|---|---|---|
| `skill_write` | `$PHUS_SKILLS_DIR/<name>/SKILL.md` | New capability, loaded on next turn |
| `skill_read` / `skill_delete` | disk | Inspect or remove skills |
| `startup_write` | `$PHUS_HOME/startup.sh` | Runs on next `phus gateway` boot |
| `self_reflect` | reads from Tape | Read past turns across sessions |
| `compact_session` | writes an anchor to Tape | Summarize old turns to free context |
| `tape_stats` | reads from Tape | Aggregate counts per session |

This is what makes the Sisyphus metaphor literal: the agent literally writes new muscles (skills) and a new wake-up routine (startup.sh) into its own disk.

### Safety boundary

The `before_tool_call` hook runs the policy before every tool execution — including meta tools. The agent cannot:

- Write outside `./skills/`, `./.phus/`, `./tmp/`, `./out/`
- Run `rm -rf /`, fork bombs, `curl|sh`, `dd if=`, `chmod -R 777 /`, `mkfs`

These rules live in `src/core/policy.ts` and apply uniformly to every channel, every session, every tool. Operators and agents share the same boundary.

### Extensibility

Three extension points, each with a distinct audience:

| Point | Audience | Discovery | Format |
|---|---|---|---|
| **Hook** | Plugin authors | `$PHUS_HOME/plugins/*.ts` | TypeScript via `jiti` |
| **Skill** | Prompt authors | `$PHUS_SKILLS_DIR/*/SKILL.md` | Markdown + YAML frontmatter |
| **Channel** | Integrators | Programmatic (`registerChannel`) | `ChannelAdapter` interface |

---

## 3. Inspirations

Phus is not a fresh invention. It composes three open-source projects, each contributing a distinct axis:

### From Bub — orchestration philosophy

[Bub](https://github.com/bubbuild/bub) is a Python hook-first runtime for agents that live in group chats. Phus inherits its entire turn pipeline semantics.

**What we copied:**
- The **hook chain** (`resolve_session → load_state → build_prompt → run_model → save_state → render_outbound → dispatch_outbound`) — adopted verbatim in `PhusAgent.turn()`.
- The **three hook modes**: `firstresult` (first non-null wins), `call_many` / `broadcast` (all implementations run, results collected), and Phus's extension `chain` (output becomes next input).
- The **Tape context** philosophy — context is rebuilt from append-only records, not carried as mutable session state. Easier to inspect, replay, hand off.
- The **operator-equivalence stance** — humans and agents share the same runtime boundaries, audit trail, and handoff model. No framework-only shortcuts.
- The **Agent Skills standard** skill format — one skill = one directory + `SKILL.md` + YAML frontmatter.
- The **built-ins-are-replaceable** stance — default hooks register first, plugins can override by registering at higher priority.

**What we changed:**
- Language: TypeScript (not Python) — needed for pi-mono integration.
- Model runner: replaced Bub's self-written model code with Pi's `Agent.prompt()`.
- Tape physical layer: SQLite (not JSONL) — better indexing for `replay(sessionId)` and `summary()`.
- Plugin discovery: file-based via `jiti` (Bub uses `pluggy` + Python entry points).
- Channel discovery: hard-coded in `gateway` command (Bub uses `provide_channels` hook; we keep that as a future migration).

See `documents/Plan-correction.md` for the full Bub-vs-Phus comparison.

### From Pi — agent runtime

[pi-mono](https://github.com/badlogic/pi-mono) is Mario Zechner's TypeScript monorepo for building AI agents. Phus treats Pi as the engine and writes only the orchestration layer on top.

**What we use:**
- **`@mariozechner/pi-agent-core`** — `Agent` class with state, event stream, `transformContext`, `beforeToolCall`, `afterToolCall`. The entire LLM loop and tool dispatch is Pi's responsibility.
- **`@mariozechner/pi-ai`** — `getModel(provider, modelId)` for type-safe model lookup; `getEnvApiKey` for automatic provider key loading.
- **`@sinclair/typebox`** (re-exported as `Type` from `pi-ai`) — schema definition for tool parameters, validated by Pi before each LLM call.
- **Pi's RPC mode** (planned, not yet integrated) — JSONL protocol over stdio for low-latency CLI integration.

**What we don't use:**
- `@mariozechner/pi-coding-agent` — its built-in TUI is more complex than we need; we built ours with `ink` for full control.
- `@mariozechner/pi-tui` — same reason.
- Pi's extension system (`ExtensionAPI`, `loadExtensions`) — we replace it with our simpler plugin loader.
- Pi's session manager and compaction — we have our own (Tape + `compact_session` meta tool).

The split is clean: **Pi handles LLM + tool loop + provider abstraction; Phus handles hooks + Tape + Skills + Policy + Plugins + Channel adapters.**

### From OpenClaw — gateway & channels

[OpenClaw](https://github.com/openclaw/openclaw) is the open-source personal AI assistant framework ("The AI that really does things"). It proved that a local-first, multi-channel agent with a Skills/Memory split can be a real product, not a demo.

**What we adopted:**
- **The four-layer mental model**: Channel → Gateway → Agent → Skills/Memory. Phus collapses Gateway and Agent into one process but keeps the layering conceptually.
- **Local-first runtime** — Phus runs on your machine; only the LLM call is external.
- **Multi-channel as a first-class concern** — `phus gateway --websocket --telegram` matches OpenClaw's "20+ messaging platforms" stance.
- **Skills as user-authored Markdown** — both projects use the Agent Skills standard (`SKILL.md` with frontmatter).
- **Heartbeat / Cron pattern** — `startup.sh` is Phus's version of OpenClaw's Heartbeat: a script that runs at boot to set up scheduled work, warm caches, fetch external state.

**What we deliberately diverge on:**
- **Tape, not Markdown memory** — OpenClaw stores long-term memory as flat Markdown files. Phus uses SQLite because (a) replay per session is O(session) instead of O(all files), (b) we can index and aggregate, (c) the JSONL-per-session equivalent is harder to inspect programmatically.
- **Self-evolution via meta tools** — OpenClaw's skills are static (written by humans). Phus's `skill_write` meta tool lets the **agent** author new skills. This is the Sisyphus "muscle memory" metaphor made literal.
- **Hook-first, not config-first** — OpenClaw's customization is mostly YAML config. Phus uses code (TypeScript plugins loaded via jiti) so extension authors can express arbitrary logic, not just config trees.
- **Operator equivalence** — OpenClaw's safety model is platform-level (sandboxing, OS-level isolation). Phus enforces it at the tool-call layer via the `before_tool_call` hook, so the same rules apply to every channel and every session.
- **Hook granularity** — OpenClaw's extension points are at the lifecycle level (start/stop/message). Phus's hooks are at the **turn-stage** level (7 stages per turn), inspired by Bub. This lets plugins intercept LLM calls, tool decisions, and outbound rendering — not just "a message arrived".

See [openclaw/openclaw](https://github.com/openclaw/openclaw) and [clawd.bot](https://clawd.bot/) for OpenClaw itself.

---

## 4. How to read this codebase

If you want to understand Phus, read in this order:

1. **`src/core/types.ts`** — the data model (Envelope, Outbound, Turn, TapeEntry, Skill)
2. **`src/core/hook.ts`** — the registry and three modes
3. **`src/core/tape.ts`** — SQLite schema and queries
4. **`src/core/skill.ts`** — Agent Skills discovery
5. **`src/bridge/pi-agent.ts`** — the turn pipeline (the heart of Phus)
6. **`src/channels/cli.ts`** + **`src/tui/App.tsx`** — two channel implementations
7. **`src/core/plugin.ts`** — how plugins hook in

If you want to extend Phus, start with **`documents/Plugins.md`**.

If you want to deploy Phus, read **`documents/Deployment.md`**.

Sources:
- [openclaw/openclaw on GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw — Personal AI Assistant (clawd.bot)](https://clawd.bot/)
- [Bub on GitHub](https://github.com/bubbuild/bub)
- [pi-mono on GitHub](https://github.com/badlogic/pi-mono)
