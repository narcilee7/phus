// src/commands/channels.ts
// Channel collection for gateway mode.
//
// Combines CLI-flag channels (telegram/websocket/sse) with whatever
// plugins register via the `provide_channels` hook. De-duplicates by
// channel name (plugins may overlap with CLI flags).

import type { ChannelAdapter } from "@/channels/base.js";
import type { HookContext } from "@/core/runtime/hook.js";
import { makeCtx } from "@/core/runtime/hook.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";

export interface ChannelOpts {
  telegram?: boolean;
  websocket?: string;
  sse?: string;
}

/** Collect channels from CLI flags + plugins' provide_channels hook. */
export async function collectChannels(
  agent: PhusAgent,
  opts: ChannelOpts,
): Promise<ChannelAdapter[]> {
  const channels: ChannelAdapter[] = [];

  // CLI flags (hardcoded)
  if (opts.telegram) {
    const { TelegramChannel } = await import("@/channels/telegram.js");
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      console.error("[phus] TELEGRAM_TOKEN not set");
      process.exit(1);
    }
    channels.push(new TelegramChannel(token));
  }
  if (opts.websocket) {
    const { WebSocketChannel } = await import("@/channels/websocket.js");
    channels.push(new WebSocketChannel(parseInt(opts.websocket, 10)));
  }
  if (opts.sse) {
    const { SSEChannel } = await import("@/channels/sse.js");
    channels.push(new SSEChannel(parseInt(opts.sse, 10)));
  }

  // Plugins' provide_channels hook (broadcast) — appended after CLI flags
  const ctx: HookContext = makeCtx({
    state: {},
    tape: agent.tape,
    skills: agent.skills,
  });
  const pluginContributions = await agent.hooks.execute<ChannelAdapter[][]>(
    "provide_channels",
    ctx,
    "broadcast",
  );
  if (pluginContributions && pluginContributions.length > 0) {
    for (const list of pluginContributions) {
      if (Array.isArray(list)) channels.push(...list);
    }
  }

  // Deduplicate by channel name
  const seen = new Set<string>();
  return channels.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}