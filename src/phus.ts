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
      console.log(`[phus] 📡 ${ch.name} channel listening`);
    }
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

program.parseAsync(process.argv).catch((err) => {
  console.error("[phus] fatal:", err);
  process.exit(1);
});
