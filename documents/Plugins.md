# Plugins

Extend Phus without forking. Plugins can:

- **Register hooks** (intercept and modify any phase of the turn pipeline)
- **Register channels** (custom transports beyond CLI/Telegram/WebSocket/SSE)
- **Register skills** (Agent Skills standard `SKILL.md` files at runtime)

They run in-process and share the same SQLite tape and Pino logger as core.

---

## Discovery

Phus scans two locations on startup (before any turn runs):

1. **`$PHUS_HOME/plugins/<name>.ts`** or **`$PHUS_HOME/plugins/<name>/index.ts`**
2. **`$PHUS_HOME/phus.config.yaml`** under `plugins:`

YAML supports both string paths and structured entries:

```yaml
plugins:
  - name: my-plugin
    path: ./plugins/my-plugin.ts
    config:
      apiKey: ${SOME_API_KEY}
      debug: true

  - ./another-plugin.ts
```

If the same plugin appears in both, the YAML entry wins (and its `config` is passed in).

Run `phus plugins-list` to see what's loaded.

---

## Plugin API

A plugin is a TypeScript module exporting a default object:

```typescript
import type { Plugin, PluginContext } from "phus";

export default {
  name: "my-plugin",
  register(ctx: PluginContext) {
    // ... do whatever
  },
} satisfies Plugin;
```

`PluginContext` exposes:

```typescript
interface PluginContext {
  hooks: HookRegistry;
  registerSkill: (skill: Skill) => void;
  registerChannel: (channel: ChannelAdapter) => void;
  config: unknown;          // from phus.config.yaml::plugins[].config
}
```

`hooks` is the same registry the core uses — see [`packages/core/src/runtime/hook/registry.ts`](../packages/core/src/runtime/hook/registry.ts) for the full API.

---

## Example: a hook plugin

The classic case: log every tool call.

```typescript
// ~/.phus/plugins/tool-logger.ts
import { logger } from "phus/core/logger";

export default {
  name: "tool-logger",
  register(ctx) {
    // before_tool_call — runs in chain mode by default
    ctx.hooks.register(
      "before_tool_call",
      async (hookCtx) => {
        logger.info("plugin.tool_call", {
          sessionId: hookCtx.sessionId,
          // hookCtx.extras is populated by the bridge layer with the actual tool call
          tool: (hookCtx.extras as any).toolName,
        });
        return hookCtx;
      },
      { mode: "chain", priority: 100 },
    );
  },
};
```

Save the file, restart `phus gateway`, and every tool call emits a `plugin.tool_call` event into `phus.jsonl`.

---

## Example: a channel plugin

Add a custom transport — say, an IRC bridge:

```typescript
// ~/.phus/plugins/irc-channel.ts
import * as net from "node:net";
import type { ChannelAdapter } from "phus/channels/base";

class IrcChannel implements ChannelAdapter {
  readonly name = "irc";
  private agent: any;
  private socket: net.Socket;

  constructor(host: string, port: number, nick: string) {
    this.socket = net.connect(port, host);
    this.socket.write(`NICK ${nick}\r\nUSER ${nick} 0 * :${nick}\r\n`);
  }

  listen(agent: any) {
    this.agent = agent;
    let buf = "";
    this.socket.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\r\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^:(\S+) PRIVMSG (\S+) :(.*)$/);
        if (!m) continue;
        const [, from, channel, text] = m;
        agent.turn({
          id: crypto.randomUUID(),
          from,
          content: text,
          type: "text",
          channel: "irc",
          metadata: { chatId: channel },
          ts: Date.now(),
        }, this);
      }
    });
  }

  async send(outbounds: any[]) {
    for (const o of outbounds) {
      this.socket.write(`PRIVMSG ${o.to} :${o.content}\r\n`);
    }
  }
}

export default {
  name: "irc-channel",
  register(ctx) {
    ctx.registerChannel(new IrcChannel(
      process.env.IRC_HOST!,
      parseInt(process.env.IRC_PORT ?? "6667"),
      process.env.IRC_NICK ?? "phus",
    ));
  },
};
```

Note: `registerChannel` only registers the channel — to actually run it, add it to your `phus gateway` invocation by extending the gateway command. (This is currently hard-coded in `src/phus.ts`; a future `gateway --plugins` flag will wire it up automatically.)

---

## Example: a skill plugin

```typescript
// ~/.phus/plugins/haiku-skill.ts
export default {
  name: "haiku-skill",
  register(ctx) {
    ctx.registerSkill({
      name: "respond-in-haiku",
      description: "Reply only in 5-7-5 haiku form.",
      body: `# Respond in Haiku\n\nAll replies must follow 5-7-5 syllable structure...`,
      location: "<runtime>",   // synthetic — not on disk
      source: "user",
      metadata: { author: "human", version: "1.0.0" },
      createdAt: Date.now(),
    });
  },
};
```

Skills registered this way are visible in `phus skills` and injected into the system prompt on the next turn. They are **not** persisted to disk — drop a `SKILL.md` file under `$PHUS_SKILLS_DIR` instead if you want persistence.

---

## Hook modes

`register(name, impl, { mode })` accepts three modes (mirrors Bub's pluggy semantics):

| Mode | Semantics | When to use |
|---|---|---|
| `"first_result"` | Return first non-null/undefined result | `resolve_session`, `build_prompt`, admission decisions |
| `"chain"` | Pipe ctx through implementations in priority order (highest first) | Observability, transforms (most common) |
| `"broadcast"` | Invoke all in parallel, collect all results | `load_state`, `save_state`, `render_outbound`, `dispatch_outbound` |

Priority is descending — `priority: 100` runs before `priority: 0`. Equal priority preserves registration order.

---

## Loading order

1. Phus starts → constructs `PhusAgent`
2. PhusAgent constructor calls `loadPlugins(hooks, channels)` (deferred async)
3. For each discovered plugin path, Phus invokes `jiti(path)` to load it as TS
4. The plugin's `register(ctx)` is called synchronously (or async — Phus awaits it if it returns a Promise, but logs failures and continues)
5. After all plugins load, the agent is ready to turn

If a plugin throws, Phus logs `plugin.load_failed` and continues with the others. **One bad plugin cannot prevent startup.**

---

## Error handling

- Plugin **load errors** (syntax error, file not found) → logged at `error` level, plugin skipped
- Plugin **register errors** (thrown from `register()`) → logged at `error` level, plugin skipped
- Plugin **runtime errors** (thrown from a hook during a turn) → logged at `error` level, hook chain continues

All events go to `$PHUS_LOG_FILE` (default `./logs/phus.jsonl`).

---

## Debugging

```bash
# What did Phus load?
phus plugins-list

# What was the error?
phus logs --event plugin.load_failed --follow

# Bump log level
PHUS_LOG_LEVEL=debug phus gateway --websocket 8080
```

---

## What's *not* a plugin (yet)

- **Meta tools** — currently hard-coded in [`packages/runtime/src/infra/meta/index.ts`](../packages/runtime/src/infra/meta/index.ts). Adding `ctx.registerMetaTool(...)` would be straightforward; PRs welcome.
- **Tape providers** — only SQLite is built in. The `Tape` class could be made pluggable.
- **Custom models / providers** — use Pi's built-in providers; add a new Pi provider if you need something we don't ship.
