// src/commands/channels.ts
// Channel collection for gateway mode.
//
// Combines YAML config channels, CLI-flag channels, and plugin-provided
// channels. De-duplicates by channel name; CLI flags override YAML, and
// plugins override neither.

import type { ChannelAdapter, ChannelStatus } from "@/channels/base.js";
import type { ChannelConfig } from "@/infra/config/schema.js";
import type { HookContext } from "@/core/runtime/hook.js";
import { makeCtx } from "@/core/runtime/hook.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/infra/logging.js";

export interface ChannelOpts {
  telegram?: boolean;
  websocket?: string;
  sse?: string;
  slack?: boolean;
  email?: boolean;
  whatsapp?: boolean;
}

/** Build a built-in channel from its YAML config entry. */
export async function buildChannelFromConfig(cfg: ChannelConfig): Promise<ChannelAdapter | undefined> {
  switch (cfg.type) {
    case "websocket": {
      const { WebSocketChannel } = await import("@/channels/websocket.js");
      return new WebSocketChannel({
        port: cfg.port ?? 3001,
        host: cfg.host,
        path: cfg.path,
      });
    }
    case "sse": {
      const { SSEChannel } = await import("@/channels/sse.js");
      return new SSEChannel({
        port: cfg.port ?? 3002,
        host: cfg.host,
        path: cfg.path,
      });
    }
    case "telegram": {
      const { TelegramChannel } = await import("@/channels/telegram.js");
      return new TelegramChannel({
        token: cfg.token,
        allowedUsers: cfg.allowedUsers,
        allowedChats: cfg.allowedChats,
      });
    }
    case "slack": {
      const { SlackChannel } = await import("@/channels/slack.js");
      return new SlackChannel({
        botToken: cfg.botToken,
        appToken: cfg.appToken,
        allowedUsers: cfg.allowedUsers,
      });
    }
    case "email": {
      const { EmailChannel } = await import("@/channels/email.js");
      return new EmailChannel({
        host: cfg.host,
        user: cfg.user,
        password: cfg.password,
        imapPort: cfg.imapPort,
        tls: cfg.tls,
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        smtpSecure: cfg.smtpSecure,
        pollIntervalSeconds: cfg.pollIntervalSeconds,
        mailbox: cfg.mailbox,
      });
    }
    case "whatsapp": {
      const { WhatsAppChannel } = await import("@/channels/whatsapp.js");
      return new WhatsAppChannel();
    }
    default:
      return undefined;
  }
}

/** Collect channels from YAML config + CLI flags + plugins' provide_channels hook. */
export async function collectChannels(
  agent: PhusAgent,
  opts: ChannelOpts,
  configChannels: ChannelConfig[] = [],
): Promise<ChannelAdapter[]> {
  const channels: ChannelAdapter[] = [];
  const fromCli = new Set<string>();

  // CLI flags (highest priority)
  if (opts.telegram) {
    const { TelegramChannel } = await import("@/channels/telegram.js");
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      console.error("[phus] TELEGRAM_TOKEN not set");
      process.exit(1);
    }
    channels.push(new TelegramChannel({ token }));
    fromCli.add("telegram");
  }
  if (opts.websocket) {
    const { WebSocketChannel } = await import("@/channels/websocket.js");
    channels.push(new WebSocketChannel({ port: parseInt(opts.websocket, 10) }));
    fromCli.add("websocket");
  }
  if (opts.sse) {
    const { SSEChannel } = await import("@/channels/sse.js");
    channels.push(new SSEChannel({ port: parseInt(opts.sse, 10) }));
    fromCli.add("sse");
  }
  if (opts.slack) {
    const { SlackChannel } = await import("@/channels/slack.js");
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!botToken || !appToken) {
      console.error("[phus] SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set");
      process.exit(1);
    }
    channels.push(new SlackChannel({ botToken, appToken }));
    fromCli.add("slack");
  }
  if (opts.email) {
    const { EmailChannel } = await import("@/channels/email.js");
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error("[phus] EMAIL_HOST, EMAIL_USER and EMAIL_PASSWORD must be set");
      process.exit(1);
    }
    channels.push(new EmailChannel());
    fromCli.add("email");
  }
  if (opts.whatsapp) {
    const { WhatsAppChannel } = await import("@/channels/whatsapp.js");
    channels.push(new WhatsAppChannel());
    fromCli.add("whatsapp");
  }

  // YAML config channels (skip names already provided by CLI flags)
  for (const cfg of configChannels) {
    if (fromCli.has(cfg.type)) continue;
    try {
      const channel = await buildChannelFromConfig(cfg);
      if (channel) channels.push(channel);
    } catch (err: any) {
      logger.error("channel.config_build_failed", { type: cfg.type, error: err?.message ?? err });
    }
  }

  // Plugins' provide_channels hook (broadcast) — appended after built-ins
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

  // Deduplicate by channel name (first wins)
  const seen = new Set<string>();
  return channels.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/** Gather a diagnostic snapshot for every channel that supports it. */
export async function channelStatuses(channels: ChannelAdapter[]): Promise<ChannelStatus[]> {
  const out: ChannelStatus[] = [];
  for (const ch of channels) {
    try {
      out.push(await (ch.status?.() ?? Promise.resolve({ name: ch.name, listening: false, connected: 0 })));
    } catch (err: any) {
      logger.warn("channel.status_failed", { name: ch.name, error: err?.message ?? err });
      out.push({ name: ch.name, listening: false, connected: 0 });
    }
  }
  return out;
}
