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

const program = new Command();

program
  .name("phus")
  .description("⛰️  Phus — self-evolving agent. Push the stone up the mountain.")
  .version("0.1.0");

program
  .command("chat")
  .description("Interactive chat mode (stdin/stdout REPL)")
  .action(() => {
    const agent = new PhusAgent();
    const channel = new CLIChannel();
    channel.listen(agent);
  });

program
  .command("run <prompt>")
  .description("Run a single prompt and print the response")
  .action(async (prompt: string) => {
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
    if (mode === "default") {
      console.log("[phus] no channels enabled; use --telegram / --websocket / --sse");
      process.exit(1);
    }
    const agent = new PhusAgent();
    const channels: import("./channels/base.js").ChannelAdapter[] = [];
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
    if (channels.length === 0) {
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

program.parseAsync(process.argv).catch((err) => {
  console.error("[phus] fatal:", err);
  process.exit(1);
});
