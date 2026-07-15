# Phase A — Finish Bub

> Goal: copy every remaining Bub feature into Phus before looking at OpenClaw, Heartbeat, or anything else.
>
> After Phase A, the Bub → Phus mapping will be **1:1** at the hook layer. Phase B (Heartbeat, cron, etc.) will then sit *on top of* the Bub API rather than alongside it.

---

## A.0 Scope

| # | Feature | Source | Status | Priority |
|---|---|---|---|---|
| A.1 | `provide_channels` | Bub `hookspecs.py` | missing | **HIGH** — current `gateway` command hardcodes channels, plugins can't add ones that start automatically |
| A.2 | `register_cli_commands` | Bub `hookspecs.py` | missing | **HIGH** — plugins can't add `phus xxx` subcommands |
| A.3 | `,foo` internal commands | Bub CLI | missing | **HIGH** — Bub's comma-prefix REPL is much faster than `/help` menus for power users |
| A.4 | `provide_steering_inbox` | Bub `hookspecs.py` | half-done (Pi's `steer`/`followUp` are used directly, no Bub wrapper) | MEDIUM — needed for Heartbeat in Phase B |
| A.5 | `onboard_config` | Bub `hookspecs.py` | missing | LOW — onboarding flow, defer until post-launch |

**Out of scope (deferred):**
- `provide_tape_store` — single SQLite store is sufficient
- `run_model` / `run_model_stream` hooks — we delegate entirely to Pi
- `register_cli_commands` for interactive-mode command palette — Phase A.3 covers the REPL case

---

## A.1 `provide_channels`

### Background

Bub lets plugins declare channels by implementing the `provide_channels` hook:

```python
# Bub
@hookimpl
def provide_channels(self, message_handler):
    return [IrcChannel("irc.example.com"), WebChannel()]
```

Phus today: `gateway` command in `src/phus.ts` hardcodes Telegram/WS/SSE. The plugin loader *does* push to `PhusAgent._internal.channels`, but `gateway` never reads them. **Result: plugins can register channels but they're never started.**

### Design

```typescript
// New hook
type provide_channels = (ctx: HookContext) => Promise<ChannelAdapter[] | undefined>

// Registered as BROADCAST — each plugin contributes channels
ctx.hooks.register("provide_channels", async (c) => [myChannel1, myChannel2], {
  mode: "broadcast",
  priority: 0,
});
```

The `gateway` command calls:

```typescript
const contributed = await hooks.execute<ChannelAdapter[][]>(
  "provide_channels", ctx, "broadcast"
);
const allChannels = [...hardcoded, ...(contributed ?? []).flat()];
for (const ch of allChannels) await ch.listen(agent);
```

### Migration

- Move the `gateway` channel construction into a single `collectChannels(hooks, opts)` helper
- Replace the hardcoded if/else chain
- Add `ctx.registerChannel(channel)` convenience on PluginContext (one-shot, doesn't require hook implementation) — keep both paths

### Test

- Plugin registers a fake channel via hook → `gateway --dry-run` shows it
- Plugin registers via `ctx.registerChannel` → same
- No plugins loaded → only the hardcoded flags still work

---

## A.2 `register_cli_commands`

### Background

Bub plugins extend the Typer root via `register_cli_commands(app)`. We use **Commander** instead of Typer, but the pattern is the same: each plugin can add a subcommand.

### Design

```typescript
// Hook signature
type register_cli_commands = (ctx: HookContext) => Promise<void>

// ctx.extras.program = the Commander root Program
// Plugins can either:
//   1. Use ctx.registerCliCommand(program => {...})  — convenience
//   2. Implement the hook directly for full control

// Convenience API
ctx.registerCliCommand((program) => {
  program
    .command("mything")
    .description("...")
    .action(() => { ... });
});
```

Implementation in `src/phus.ts`:

```typescript
program
  .command("chat").action(...)
  .command("run").action(...)
  .command("gateway").action(async (opts) => {
    const agent = new PhusAgent();
    await hooks.execute("register_cli_commands",
      { ...ctx, extras: { program } }, "broadcast");
    // start channels...
  });
```

### Migration

- The hook fires once, after PhusAgent is constructed, before any command action runs
- The `program` is passed in `extras.program` so plugins can mutate it
- Each plugin's commands become available immediately (no restart)

### Test

- Plugin adds `phus hello` command → it shows in `--help` and runs

---

## A.3 `,foo` Internal Commands

### Background

Bub's interactive REPL accepts a `,` prefix for internal commands:

```
bub> ,help
bub> ,skill name=respond-concise
bub> ,fs.read path=README.md
bub> ,fs.write path=foo.yaml content=...
```

This is **faster** than slash commands because:
- `,` is a single keystroke; `/` requires shift on US layouts
- Bub's `,foo args=value` syntax is shell-like and parseable
- `,` conventionally means "meta/system" in many CLIs (vim, mutt, etc.)

### Design

#### Syntax

```
,name              - call command with no args
,name key=val      - call command with one kwarg
,name k1=v1 k2=v2  - multiple kwargs
,name text args    - positional args (separated by spaces)
```

#### Built-in commands

| Command | Args | Description |
|---|---|---|
| `,help` | — | list all commands |
| `,skills` | — | list skills |
| `,skill` | `name=<n>` | print skill body |
| `,tape` | — | print tape stats |
| `,trace` | `[n=5]` | last n turns |
| `,sessions` | — | list sessions |
| `,use` | `session=<id>` | switch session |
| `,compact` | `[keep=10]` | compact |
| `,fs.read` | `path=<p>` | print file |
| `,fs.write` | `path=<p> content=<text>` | write file (must be in policy root) |
| `,reload` | — | reload skills + plugins |
| `,clear` | — | clear chat |
| `,quit` | — | exit |

#### Implementation

Add `src/core/internal-commands.ts`:

```typescript
export interface InternalCommand {
  name: string;
  description: string;
  usage?: string;
  /** Parse args from `key=val` pairs and positional tokens. */
  handler: (args: Record<string, string>, positional: string[]) => Promise<string>;
}

const registry = new Map<string, InternalCommand>();

export function register(cmd: InternalCommand) { ... }
export function list(): InternalCommand[] { ... }
export async function execute(line: string): Promise<string | null> { ... }
```

#### Plugin extension

Plugins can register commands via a new PluginContext method:

```typescript
ctx.registerInternalCommand({
  name: "mything",
  description: "...",
  handler: async (args) => "ok",
});
```

#### TUI integration

TUI accepts both `/foo` (Phus) and `,foo` (Bub style) as command prefixes. The `,` prefix is **primary** for the REPL feel; `/` is kept as an alias for muscle memory from Claude Code / aider.

### Migration

- New file `src/core/internal-commands.ts` (registry + parser + handlers)
- Register built-in commands on module load
- Wire into `CLIChannel.listen()` (current REPL) and `TUI/App.tsx` (slash handler)
- Plugin loader calls `ctx.registerInternalCommand` for each plugin-registered command

### Test

- `,help` prints list
- `,skill name=foo` reads skill body
- `,trace 10` shows 10 turns
- Unknown command shows error, doesn't crash
- Plugin-registered command works after `/reload`

---

## A.4 `provide_steering_inbox`

### Background

Bub's `SteeringInboxProtocol`:

```python
class SteeringInboxProtocol(Protocol):
    async def enqueue_message(self, message, state) -> None: ...
    async def drain_messages(self, state) -> list[Message]: ...
    def message_count(self, state) -> int: ...
```

Used to **inject mid-session messages** without going through a channel. Heartbeat (Phase B) will use this. Today Phus only has Pi's `steer()` / `followUp()` which we call directly — no Bub-shaped wrapper.

### Design

```typescript
// src/core/steering.ts

export interface SteeringInbox {
  enqueueMessage(envelope: Envelope, reason?: string): Promise<void>;
  drainMessages(): Promise<Envelope[]>;
  messageCount(): number;
}

export class PiSteeringInbox implements SteeringInbox {
  private queue: Envelope[] = [];
  
  async enqueueMessage(envelope: Envelope, reason?: string): Promise<void> {
    this.queue.push(envelope);
    logger.info("steering.enqueued", { reason, depth: this.queue.length });
  }
  
  async drainMessages(): Promise<Envelope[]> {
    const drained = this.queue;
    this.queue = [];
    return drained;
  }
  
  messageCount(): number {
    return this.queue.length;
  }
}

// Hook signature
type provide_steering_inbox = (ctx: HookContext) => Promise<SteeringInbox | undefined>;
// Registered as firstresult — first implementation wins
```

### Integration with Pi Agent

In `PhusAgent.before_llm_call` (or in a new step in `turn()`):

```typescript
// After resolve_session, before tool loop:
const inbox = await this.hooks.execute<SteeringInbox>(
  "provide_steering_inbox", ctx, "firstresult",
);
if (inbox) {
  const pending = await inbox.drainMessages();
  for (const env of pending) {
    // Wrap in AgentMessage and pass to Pi's steer queue
    this.piAgent.steer({
      role: "user",
      content: [{ type: "text", text: env.content }],
      timestamp: env.ts,
    });
  }
}
```

### Migration

- New file `src/core/steering.ts`
- Add `provide_steering_inbox` to HookName union
- Default impl: returns a singleton `PiSteeringInbox` (stored on PhusAgent)
- Drain point: at the start of each `turn()` and before each LLM call
- Future Phase B Heartbeat uses `inbox.enqueueMessage(env)` to nudge the agent

### Test

- Plugin registers a custom inbox → plugin receives enqueueMessage calls
- Default inbox: enqueue + drain returns in FIFO order
- Drain at turn start: agent receives the injected message as part of the conversation
- Two enqueues then drain: returns both messages

---

## A.5 `onboard_config` (low priority, defer)

Bub's onboarding flow collects config from all plugins, validates it, and writes `~/.bub/config.yml`. Useful for first-run UX.

For Phus: defer until we have a `phus init` command on the roadmap. Not blocking.

---

## Code touch list

| File | Change |
|---|---|
| `src/core/hook.ts` | Add 3 new hook names: `provide_channels`, `register_cli_commands`, `provide_steering_inbox` |
| `src/core/internal-commands.ts` | NEW — registry + parser + built-ins |
| `src/core/steering.ts` | NEW — `SteeringInbox` interface + `PiSteeringInbox` impl |
| `src/bridge/pi-agent.ts` | Wire `provide_steering_inbox` drain into `turn()` |
| `src/channels/cli.ts` | Accept `,foo` lines, dispatch via internal-commands registry |
| `src/tui/App.tsx` | Accept `,` prefix in addition to `/` |
| `src/phus.ts` | Refactor `gateway` to call `collectChannels()`; call `register_cli_commands` hook once at startup |
| `src/core/plugin.ts` | Add `registerChannel` (already exists) + `registerCliCommand` + `registerInternalCommand` to PluginContext |
| `test/phase-a.test.ts` | NEW — integration tests for all 4 features |
| `documents/Plugins.md` | Update with new PluginContext methods |
| `documents/Architecture.md` | Update "Inspirations → Bub" section: "fully ported" instead of "Bub-style" |

---

## Migration order

1. **A.3 first** — `,foo` commands are pure additions, no behavior change. Lets us test the registry pattern in isolation.
2. **A.4 second** — `SteeringInbox` is a small wrapper, no churn.
3. **A.1 third** — `provide_channels` requires touching the gateway command but is contained.
4. **A.2 last** — `register_cli_commands` is the highest blast-radius (touches Commander root). Test thoroughly with a sample plugin.

After A.1–A.4, Phus is **Bub-complete at the hook layer**.

---

## Open questions

1. Should `,foo` and `/foo` both work in TUI, or only `,foo`? (User said `,foo` is primary — keep both for compat.)
2. Should `register_cli_commands` run BEFORE or AFTER the built-in commands? (After — plugins extend, not replace.)
3. Should `provide_steering_inbox` drain happen at every LLM call (Pi's natural break point) or only at turn start? (At every LLM call — Heartbeat needs to be able to nudge mid-tool-loop.)
