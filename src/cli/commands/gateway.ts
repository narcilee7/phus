// src/cli/commands/gateway.ts
// `phus gateway` — start channel listeners (multi-channel mode).
//
// Boots the agent, registers plugins, collects channels (CLI flags +
// plugin `provide_channels` hook), wires the scheduler + mesh into
// the internal-commands registry, installs SIGTERM/SIGINT handlers
// that cleanly dispose.

import type { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { PhusAgent } from "@/bridge/pi-agent.js";
import { bootstrap } from "@/infra/bootstrap.js";
import { logger } from "@/infra/logging.js";
import { loadConfig } from "@/infra/config/index.js";
import { initInternalCommands } from "@/core/runtime/internal-commands/index.js";
import { channelStatuses, collectChannels } from "@/commands/channels.js";
import type { ChannelAdapter } from "@/channels/base.js";
import type { Schedule } from "@/types/scheduler/index.js";

export function registerGatewayCommand(program: Command): void {
  program
    .command("gateway")
    .description("Start channel listeners (multi-channel gateway mode)")
    .option("--telegram", "Enable Telegram channel (requires TELEGRAM_TOKEN env)")
    .option("--websocket <port>", "Enable WebSocket channel on the given port")
    .option("--sse <port>", "Enable SSE channel on the given port")
    .action(async (opts: { telegram?: boolean; websocket?: string; sse?: string }) => {
      const mode = bootstrap();
      const config = loadConfig();
      const handle = await PhusAgent.create({ config });
      const channels = await collectChannels(handle.internals, opts, config.channels);

      if (channels.length === 0) {
        if (mode === "default") {
          console.log("[phus] no channels enabled; use --telegram / --websocket / --sse or a plugin");
          process.exit(1);
        }
        console.log("[phus] no channels specified.");
        process.exit(1);
      }

      for (const ch of channels) {
        await ch.listen(handle.internals);
        logger.info("channel.listening", { channel: ch.name });
      }

      // Scheduler + mesh → internal-commands services (DI, no singleton).
      const { Scheduler } = await import("@/core/runtime/scheduler.js");
      const scheduler = new Scheduler(handle.internals.hooks);
      initInternalCommands({
        agent: handle.agent,
        home: () => loadConfig().paths.home,
        mesh: handle.internals.mesh,
        scheduler,
        extraChannels: () => channels,
      });

      for (const sch of loadSchedulesFromConfig()) {
        try { scheduler.register(sch); } catch (err: any) {
          logger.error("schedule.config_register_failed", { name: sch.name, error: err.message });
        }
      }
      scheduler.start();

      let shuttingDown = false;
      const shutdown = async (sig: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info("gateway.shutdown", { signal: sig });
        try { scheduler.stop(); } catch { /* ignore */ }
        for (const ch of channels) {
          try { await ch.close?.(); } catch { /* ignore */ }
        }
        await handle.dispose();
        process.exit(0);
      };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));

      const statuses = await channelStatuses(channels);
      logger.info("gateway.started", {
        channels: channels.map((c: ChannelAdapter) => c.name),
        channelStatuses: statuses,
        schedules: scheduler.list().length,
        pid: process.pid,
      });
    });
}

function loadSchedulesFromConfig(): Schedule[] {
  return loadConfig().schedules;
}