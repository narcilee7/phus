// src/channels/telegram.ts
// Telegram channel — polling bot with optional user/chat allow-lists.

import { Telegraf } from "telegraf";
import type { ChannelAdapter, ChannelStatus } from "@/channels/base.js";
import { makeEnvelopeFromChat } from "@/channels/base.js";
import type { Outbound } from "@/types/channel/index.js";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/infra/logging.js";

export interface TelegramChannelConfig {
  /** Bot token. Falls back to TELEGRAM_TOKEN env var. */
  token?: string;
  /** Comma-separated or array of allowed user ids. */
  allowedUsers?: string[] | string;
  /** Comma-separated or array of allowed chat ids. */
  allowedChats?: string[] | string;
}

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  private bot?: Telegraf;
  private agent?: PhusAgent;
  private closed = false;
  private readonly allowedUsers: Set<string>;
  private readonly allowedChats: Set<string>;

  constructor(private readonly config: TelegramChannelConfig = {}) {
    this.allowedUsers = normalizeSet(config.allowedUsers ?? envList("TELEGRAM_ALLOW_USERS"));
    this.allowedChats = normalizeSet(config.allowedChats ?? envList("TELEGRAM_ALLOW_CHATS"));
  }

  async listen(agent: PhusAgent): Promise<void> {
    if (this.closed) {
      throw new Error("TelegramChannel has already been closed");
    }

    const token = this.config.token ?? process.env.TELEGRAM_TOKEN;
    if (!token) {
      throw new Error("TelegramChannel: token not configured (set TELEGRAM_TOKEN or channels[].token)");
    }

    this.agent = agent;
    this.bot = new Telegraf(token);

    this.bot.on("text", (ctx) => {
      void this.handleText(ctx);
    });

    this.bot.on("message", (ctx) => {
      const chatId = ctx.chat?.id;
      if (chatId && ctx.message && !("text" in ctx.message)) {
        logger.debug("channel.telegram.unsupported_message", { chatId });
      }
    });

    await this.bot.launch();
    logger.info("channel.telegram.listening");
  }

  private async handleText(ctx: any): Promise<void> {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!chat || !from) return;

    const chatId = String(chat.id);
    const userId = String(from.id);
    const username = from.username ?? "";

    if (!this.isAllowed(userId, chatId)) {
      logger.warn("channel.telegram.denied", { userId, chatId, username });
      return;
    }

    const envelope = makeEnvelopeFromChat({
      channel: this.name,
      chatId,
      from: userId,
      content: ctx.message.text ?? "",
      metadata: {
        userId,
        username,
        chatType: chat.type,
      },
    });

    try {
      await this.agent?.turn(envelope, this);
    } catch (err: any) {
      logger.error("channel.telegram.turn_failed", { chatId, error: err?.message ?? err });
      try {
        await ctx.telegram.sendMessage(chat.id, `Error: ${err?.message ?? String(err)}`).catch(() => {});
      } catch {
        // ignore secondary send errors
      }
    }
  }

  private isAllowed(userId: string, chatId: string): boolean {
    if (this.allowedUsers.size === 0 && this.allowedChats.size === 0) return true;
    if (this.allowedUsers.has(userId)) return true;
    if (this.allowedChats.has(chatId)) return true;
    return false;
  }

  async send(outbounds: Outbound[]): Promise<void> {
    if (!this.bot) return;
    for (const msg of outbounds) {
      if (msg.type !== "text") continue;
      try {
        await this.bot.telegram.sendMessage(msg.to, msg.content, {
          ...(msg.replyTo ? { reply_to_message_id: Number(msg.replyTo) } : {}),
        });
      } catch (err: any) {
        logger.error("channel.telegram.send_failed", { to: msg.to, error: err?.message ?? err });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.bot?.stop();
    this.bot = undefined;
  }

  status(): ChannelStatus {
    return {
      name: this.name,
      listening: this.bot !== undefined && !this.closed,
      connected: this.bot ? 1 : 0,
      details: {
        allowedUsers: this.allowedUsers.size,
        allowedChats: this.allowedChats.size,
      },
    };
  }
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSet(value: string[] | string): Set<string> {
  const arr = Array.isArray(value) ? value : value.split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(arr);
}
