// src/channels/slack.ts
// Slack channel via Socket Mode. Listens for direct messages and
// mentions, converts them to Envelopes, and sends replies back to the
// same thread/channel.

import { App } from "@slack/bolt";
import type { ChannelAdapter, ChannelStatus } from "./base.js";
import { makeEnvelopeFromChat } from "./base.js";
import type { Outbound } from "@phus/core/types/channel/index.js";
import type { SessionAddress } from "@phus/core/types/session/index.js";
import type { SessionAddress } from "@phus/core/types/session/index.js";
import type { PhusAgent } from "../bridge/pi-agent.js";
import { logger } from "../infra/logging.js";

export interface SlackChannelConfig {
  /** Bot token. Falls back to SLACK_BOT_TOKEN env var. */
  botToken?: string;
  /** App-level token for Socket Mode. Falls back to SLACK_APP_TOKEN env. */
  appToken?: string;
  /** Comma-separated or array of allowed user ids. */
  allowedUsers?: string[] | string;
}

export class SlackChannel implements ChannelAdapter {
  readonly name = "slack";
  private app?: App;
  private agent?: PhusAgent;
  private closed = false;
  private readonly allowedUsers: Set<string>;
  private teamId = "unknown";
  private teamId = "unknown";

  constructor(private readonly config: SlackChannelConfig = {}) {
    this.allowedUsers = normalizeSet(config.allowedUsers ?? envList("SLACK_ALLOW_USERS"));
  }

  async listen(agent: PhusAgent): Promise<void> {
    if (this.closed) {
      throw new Error("SlackChannel has already been closed");
    }

    const botToken = this.config.botToken ?? process.env.SLACK_BOT_TOKEN;
    const appToken = this.config.appToken ?? process.env.SLACK_APP_TOKEN;
    if (!botToken || !appToken) {
      throw new Error(
        "SlackChannel: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set (or pass botToken + appToken)",
      );
    }

    this.agent = agent;
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    try {
      const auth = await this.app.client.auth.test();
      const id = (auth as { team_id?: string }).team_id;
      if (id) this.teamId = id;
    } catch (err) {
      logger.warn("channel.slack.team_lookup_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const auth = await this.app.client.auth.test();
      const id = (auth as { team_id?: string }).team_id;
      if (id) this.teamId = id;
    } catch (err) {
      logger.warn("channel.slack.team_lookup_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.app.message(async ({ message, say, client }) => {
      void this.handleMessage(message as any, say, client);
    });

    await this.app.start();
    logger.info("channel.slack.listening");
  }

  private async handleMessage(
    message: {
      type: string;
      user?: string;
      channel?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    },
    say: any,
    client: any,
  ): Promise<void> {
    const userId = message.user;
    const channelId = message.channel;
    const text = message.text ?? "";
    if (!userId || !channelId) return;

    // Ignore our own messages.
    try {
      const botInfo = await client.auth.test();
      if (userId === botInfo.user_id) return;
    } catch {
      // continue without self-filter
    }

    if (!this.isAllowed(userId)) {
      logger.warn("channel.slack.denied", { userId });
      return;
    }

    // Only respond to direct messages or mentions.
    const isDm = channelId.startsWith("D");
    const isMention = text.includes(`<@${userId}>`) || text.toLowerCase().startsWith("@phus");
    if (!isDm && !isMention) return;

    const content = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!content) return;

    const envelope = makeEnvelopeFromChat({
      channel: this.name,
      chatId: channelId,
      from: userId,
      content,
      replyTo: message.ts,
      metadata: {
        threadTs: message.thread_ts,
        messageTs: message.ts,
      },
      address: this.buildAddress(channelId, message.thread_ts as string | undefined, message.ts as string),
      subjectId: userId,
      displayName: (message as { user_profile?: { display_name?: string; real_name?: string } }).user_profile?.display_name
        ?? (message as { user_profile?: { display_name?: string; real_name?: string } }).user_profile?.real_name,
    });

    try {
      await this.agent?.turn(envelope, this);
    } catch (err: any) {
      logger.error("channel.slack.turn_failed", { channelId, error: err?.message ?? err });
      try {
        await say({ text: `Error: ${err?.message ?? String(err)}`, thread_ts: message.thread_ts ?? message.ts });
      } catch {
        // ignore secondary send errors
      }
    }
  }

  private buildAddress(channelId: string, threadTs?: string, rootTs?: string): SessionAddress {
    const thread = threadTs ?? (rootTs ? rootTs : undefined);
    return {
      channel: "slack",
      scope: `team:${this.teamId}`,
      conversationKey: `channel:${channelId}`,
      threadKey: thread ? `thread:${thread}` : undefined,
    };
  }

  private buildAddress(channelId: string, threadTs?: string, rootTs?: string): SessionAddress {
    const thread = threadTs ?? (rootTs ? rootTs : undefined);
    return {
      channel: "slack",
      scope: `team:${this.teamId}`,
      conversationKey: `channel:${channelId}`,
      threadKey: thread ? `thread:${thread}` : undefined,
    };
  }

  private isAllowed(userId: string): boolean {
    if (this.allowedUsers.size === 0) return true;
    return this.allowedUsers.has(userId);
  }

  async send(outbounds: Outbound[]): Promise<void> {
    if (!this.app) return;
    for (const msg of outbounds) {
      if (msg.type !== "text") continue;
      try {
        const metadata = (msg.metadata ?? {}) as Record<string, unknown>;
        const threadTs = typeof metadata.threadTs === "string" ? metadata.threadTs : undefined;
        await this.app.client.chat.postMessage({
          channel: msg.to,
          text: msg.content,
          thread_ts: threadTs,
        });
      } catch (err: any) {
        logger.error("channel.slack.send_failed", { to: msg.to, error: err?.message ?? err });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.app?.stop();
    } catch (err: any) {
      logger.warn("channel.slack.close_error", { error: err?.message ?? err });
    }
    this.app = undefined;
  }

  status(): ChannelStatus {
    return {
      name: this.name,
      listening: this.app !== undefined && !this.closed,
      connected: this.app ? 1 : 0,
      details: { allowedUsers: this.allowedUsers.size },
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
