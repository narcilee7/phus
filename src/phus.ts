#!/usr/bin/env node
// src/phus.ts
// Main entry point. Commands:
//   phus chat                       - interactive REPL
//   phus run "<prompt>"             - one-shot
//   phus gateway [--telegram] [--websocket <port>]
//   phus hooks                      - list registered hooks (diagnostic)

import { Command } from "commander";
import { CLIChannel, runOnce } from "./channels/cli.js";
import { PhusAgent } from "./bridge/pi-agent.js";
import { bootstrap } from "./core/startup.js";
import { traceSession } from "./commands/trace.js";
import { logger } from "./core/logger.js";
import { tailLogs } from "./commands/logs.js";
import { healthCheck } from "./commands/health.js";
import { resumeSession } from "./commands/resume.js";
import { ExitCode, CliExit } from "./core/exit-codes.js";
import { makeCtx, type HookContext } from "./core/hook.js";
import type { ChannelAdapter } from "./channels/base.js";

const program = new Command();

program
  .name("phus")
  .description("⛰️  Phus — self-evolving agent. Push the stone up the mountain.")
  .version("0.1.0");

// Default action: launch the TUI (interactive mode).
program.action(async () => {
  const { startTui } = await import("./tui/index.js");
  await startTui();
});

program
  .command("chat")
  .description("Alias for `phus tui` — launch the interactive TUI")
  .action(async () => {
    const { startTui } = await import("./tui/index.js");
    await startTui();
  });

program
  .command("run <prompt>")
  .description("Run a single prompt and print the response")
  .option("-p, --profile <name>", "Use a specific provider profile (overrides PHUS_PROFILE)")
  .action(async (prompt: string, opts: { profile?: string }) => {
    if (opts.profile) process.env.PHUS_PROFILE = opts.profile;
    await runOnce(prompt);
  });

program
  .command("gateway")
  .description("Start channel listeners (multi-channel gateway mode)")
  .option("--telegram", "Enable Telegram channel (requires TELEGRAM_TOKEN env)")
  .option("--websocket <port>", "Enable WebSocket channel on the given port")
  .option("--sse <port>", "Enable SSE channel on the given port")
  .action(async (opts: { telegram?: boolean; websocket?: string; sse?: string }) => {
    const mode = bootstrap();
    const agent = new PhusAgent();

    // A.1: collect channels from CLI flags + plugins' provide_channels hook
    const channels = await collectChannels(agent, opts);

    if (channels.length === 0) {
      if (mode === "default") {
        console.log("[phus] no channels enabled; use --telegram / --websocket / --sse or a plugin");
        process.exit(1);
      }
      console.log("[phus] no channels specified.");
      process.exit(1);
    }

    for (const ch of channels) {
      await ch.listen(agent);
      logger.info("channel.listening", { channel: ch.name });
    }

    // Graceful shutdown on SIGTERM/SIGINT (systemd / docker stop).
    const shutdown = async (sig: string) => {
      logger.info("gateway.shutdown", { signal: sig });
      for (const ch of channels) await ch.close?.();
      process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    logger.info("gateway.started", {
      channels: channels.map((c) => c.name),
      pid: process.pid,
    });
  });

program
  .command("hooks")
  .description("List all registered hooks (diagnostic)")
  .action(() => {
    const agent = new PhusAgent();
    console.log(JSON.stringify(agent._internal.hooks.report(), null, 2));
  });

program
  .command("skills")
  .description("List all discovered skills")
  .action(() => {
    const agent = new PhusAgent();
    for (const skill of agent._internal.skills.getAll()) {
      console.log(`- ${skill.name} (v${skill.metadata.version ?? "?"}, by ${skill.metadata.author ?? "?"})`);
      console.log(`  ${skill.description}`);
      console.log(`  ${skill.location}`);
    }
  });

program
  .command("tape")
  .description("Print tape statistics")
  .action(() => {
    const agent = new PhusAgent();
    const stats = agent._internal.tape.stats();
    console.log(JSON.stringify(stats, null, 2));
  });

program
  .command("policy")
  .description("Print active safety policy (operator-equivalence allowlist)")
  .action(() => {
    const agent = new PhusAgent();
    console.log("Active policy rules:");
    for (const rule of agent._internal.policy) {
      console.log(`  - tool: ${rule.toolName}`);
    }
    console.log("\nDefault file_write roots: ./skills, ./.phus, ./tmp, ./out");
    console.log("Default bash blocklist: rm -rf /, fork bombs, curl|sh, dd if=, chmod -R 777 /, mkfs");
  });

program
  .command("profiles")
  .description("List configured provider profiles")
  .action(async () => {
    const { formatProfiles } = await import("./core/profile.js");
    console.log(formatProfiles());
    console.log(`\nactive: ${process.env.PHUS_PROFILE ?? "(default)"}`);
    console.log(`set:    PHUS_PROFILE=<name>  or  phus run --profile <name> "..."`);
  });

program
  .command("plugins-list")
  .description("List discovered plugins from $PHUS_HOME/plugins and phus.config.yaml")
  .action(async () => {
    const { loadPlugins } = await import("./core/plugin.js");
    const { HookRegistry } = await import("./core/hook.js");
    const hooks = new HookRegistry();
    const channels: import("./channels/base.js").ChannelAdapter[] = [];
    const loaded = loadPlugins(hooks, channels);
    if (loaded.length === 0) {
      console.log("No plugins found.");
      console.log(`Search paths: $PHUS_HOME/plugins/  (PHUS_HOME=${process.env.PHUS_HOME ?? "./.phus"})`);
      console.log(`Config file:  $PHUS_HOME/phus.config.yaml`);
      return;
    }
    for (const p of loaded) {
      const mark = p.status === "ok" ? "✅" : "❌";
      console.log(`${mark} ${p.name}  ${p.path}${p.error ? `  — ${p.error}` : ""}`);
    }
  });

program
  .command("trace <sessionId>")
  .description("Print a turn timeline for one session")
  .option("-l, --limit <n>", "Max entries to show", "50")
  .option("-k, --kind <kind>", "Filter: turn | tool_call | tool_result | error | anchor")
  .option("--json", "Emit raw JSON instead of human-readable")
  .action((sessionId: string, opts: { limit: string; kind?: string; json?: boolean }) => {
    const dbPath = process.env.PHUS_TAPE_DB ?? "./tape.sqlite";
    traceSession(dbPath, sessionId, {
      limit: parseInt(opts.limit, 10),
      kind: opts.kind as any,
      json: opts.json,
    });
  });

program
  .command("logs")
  .description("Query the structured JSON log")
  .option("-f, --follow", "Stream new log lines as they arrive")
  .option("-s, --session <sessionId>", "Filter to one session")
  .option("-l, --level <level>", "Minimum log level (fatal/error/warn/info/debug/trace)", "info")
  .option("-e, --event <event>", "Filter to one event name")
  .option("-n, --limit <n>", "Show last N entries (no -f)", "50")
  .option("--json", "Emit raw JSON lines")
  .action(async (opts: { follow?: boolean; session?: string; level: string; event?: string; limit: string; json?: boolean }) => {
    const file = process.env.PHUS_LOG_FILE ?? "./logs/phus.jsonl";
    await tailLogs(file, {
      follow: opts.follow,
      session: opts.session,
      level: opts.level as any,
      event: opts.event,
      limit: parseInt(opts.limit, 10),
      json: opts.json,
    });
  });

program
  .command("compact <sessionId>")
  .description("Compact a session's tape: summarize old turns into an anchor")
  .option("-k, --keep-recent <n>", "How many recent turns to keep", "10")
  .action(async (sessionId: string, opts: { keepRecent: string }) => {
    const { compactSession } = await import("./core/compaction.js");
    const { Tape } = await import("./core/tape.js");
    const tape = new Tape(process.env.PHUS_TAPE_DB ?? "./tape.sqlite");
    const result = await compactSession(tape, sessionId, {
      keepRecent: parseInt(opts.keepRecent, 10),
    });
    tape.close();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("health")
  .description("Health check (exit 0 if healthy)")
  .option("--json", "Emit JSON")
  .action((opts: { json?: boolean }) => {
    const status = healthCheck();
    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      for (const [k, v] of Object.entries(status.checks)) {
        console.log(`${v.ok ? "✅" : "❌"} ${k}: ${v.detail ?? ""}`);
      }
    }
    process.exit(status.ok ? 0 : 1);
  });

program
  .command("tui")
  .description("Launch the interactive ink-based TUI")
  .action(async () => {
    const { startTui } = await import("./tui/index.js");
    await startTui();
  });

// A.2: register_cli_commands hook — let plugins add `phus xxx` subcommands
// Runs once, after built-in commands are registered but before parseAsync.
await registerPluginCliCommands(program);

program
  .command("resume <sessionId> [prompt]")
  .description("Resume a session from its latest checkpoint (B.2.3)")
  .action(async (sessionId: string, prompt?: string) => {
    try {
      await resumeSession(sessionId, prompt ?? "");
    } catch (err) {
      if (err instanceof CliExit) {
        console.error(`[phus] ${err.message}`);
        process.exit(err.code);
      }
      throw err;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("[phus] fatal:", err);
  process.exit(1);
});

/**
 * A.2: Drain the pending CLI command queue from plugins + run the
 * register_cli_commands hook. The queue approach lets plugins loaded
 * earlier (during phus.ts bootstrap) still register commands.
 */
async function registerPluginCliCommands(program: Command): Promise<void> {
  // 1. Drain queue (set by PluginContext.registerCliCommand during plugin load)
  const pending = ((globalThis as any).__phus_pending_cli_commands as Array<(p: any) => void>) ?? [];
  for (const fn of pending) {
    try { fn(program); } catch (err) {
      logger.error("plugin.cli_command_failed", { error: (err as Error).message });
    }
  }
  (globalThis as any).__phus_pending_cli_commands = [];

  // 2. Run the hook (plugins that prefer the hook over the convenience API)
  //    Note: we need a PhusAgent just to access the HookRegistry. We don't
  //    actually start a turn — the agent is created lazily.
  const tempAgent = new PhusAgent();
  const ctx: HookContext = makeCtx({
    sessionId: "",
    state: {},
    tape: tempAgent._internal.tape,
    skills: tempAgent._internal.skills,
    extras: { program },
  });
  await tempAgent._internal.hooks.execute(
    "register_cli_commands",
    ctx,
    "broadcast",
  );
}

/**
 * A.1: collect channels from CLI flags + plugins' provide_channels hook.
 * Plugins can register channels via either:
 *   - the `provide_channels` hook (broadcast)
 *   - the `ctx.registerChannel()` convenience on PluginContext (also goes through the hook)
 */
async function collectChannels(
  agent: PhusAgent,
  opts: { telegram?: boolean; websocket?: string; sse?: string },
): Promise<ChannelAdapter[]> {
  const channels: ChannelAdapter[] = [];

  // CLI flags first (hardcoded)
  if (opts.telegram) {
    const { TelegramChannel } = await import("./channels/telegram.js");
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      console.error("[phus] TELEGRAM_TOKEN not set");
      process.exit(1);
    }
    channels.push(new TelegramChannel(token));
  }
  if (opts.websocket) {
    const { WebSocketChannel } = await import("./channels/websocket.js");
    channels.push(new WebSocketChannel(parseInt(opts.websocket, 10)));
  }
  if (opts.sse) {
    const { SSEChannel } = await import("./channels/sse.js");
    channels.push(new SSEChannel(parseInt(opts.sse, 10)));
  }

  // Plugins' provide_channels hook (broadcast) — appended after CLI flags
  const ctx: HookContext = makeCtx({
    sessionId: "",
    state: {},
    tape: agent._internal.tape,
    skills: agent._internal.skills,
  });
  const pluginContributions = await agent._internal.hooks.execute<ChannelAdapter[][]>(
    "provide_channels",
    ctx,
    "broadcast",
  );
  if (pluginContributions && pluginContributions.length > 0) {
    for (const list of pluginContributions) {
      if (Array.isArray(list)) channels.push(...list);
    }
  }

  // Deduplicate by channel name (plugins may overlap with CLI flags)
  const seen = new Set<string>();
  return channels.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}
