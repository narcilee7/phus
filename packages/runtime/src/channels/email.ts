// src/channels/email.ts
// Email channel — polls an IMAP inbox and sends replies via SMTP.
// Phase 3 minimal implementation: one poll loop, UIDs tracked in memory.

import Imap from "imap";
import * as nodemailer from "nodemailer";
import type { ChannelAdapter, ChannelStatus } from "./base.js";
import { makeEnvelopeFromChat } from "./base.js";
import type { Outbound } from "@phus/core/types/channel/index.js";
import type { SessionAddress } from "@phus/core/types/session/index.js";
import type { SessionAddress } from "@phus/core/types/session/index.js";
import type { PhusAgent } from "../bridge/pi-agent.js";
import { logger } from "../infra/logging.js";
import { simpleParser } from "mailparser";

export interface EmailChannelConfig {
  /** IMAP host. Falls back to EMAIL_HOST env var. */
  host?: string;
  /** IMAP username. Falls back to EMAIL_USER env var. */
  user?: string;
  /** IMAP password. Falls back to EMAIL_PASSWORD env var. */
  password?: string;
  /** IMAP port. Default 993. */
  imapPort?: number;
  /** Use TLS for IMAP. Default true. */
  tls?: boolean;
  /** SMTP host. Defaults to IMAP host, then EMAIL_SMTP_HOST env. */
  smtpHost?: string;
  /** SMTP port. Default 587. */
  smtpPort?: number;
  /** SMTP secure (TLS). Default false. */
  smtpSecure?: boolean;
  /** Poll interval in seconds. Default 60. */
  pollIntervalSeconds?: number;
  /** Mailbox to poll. Default INBOX. */
  mailbox?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export class EmailChannel implements ChannelAdapter {
  readonly name = "email";
  private agent?: PhusAgent;
  private closed = false;
  private pollTimer?: NodeJS.Timeout;
  private seenUids = new Set<number>();
  private lastUid = 0;
  private pollCount = 0;
  private readonly config: Required<Pick<EmailChannelConfig, "imapPort" | "tls" | "smtpPort" | "smtpSecure" | "pollIntervalSeconds" | "mailbox">> &
    Pick<EmailChannelConfig, "host" | "user" | "password" | "smtpHost">;

  constructor(cfg: EmailChannelConfig = {}) {
    this.config = {
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      smtpHost: cfg.smtpHost,
      imapPort: cfg.imapPort ?? 993,
      tls: cfg.tls ?? true,
      smtpPort: cfg.smtpPort ?? 587,
      smtpSecure: cfg.smtpSecure ?? false,
      pollIntervalSeconds: cfg.pollIntervalSeconds ?? 60,
      mailbox: cfg.mailbox ?? "INBOX",
    };
  }

  private resolveCredentials(): { host: string; user: string; password: string } {
    const host = this.config.host ?? process.env.EMAIL_HOST;
    const user = this.config.user ?? process.env.EMAIL_USER;
    const password = this.config.password ?? process.env.EMAIL_PASSWORD;
    if (!host || !user || !password) {
      throw new Error(
        "EmailChannel: EMAIL_HOST, EMAIL_USER and EMAIL_PASSWORD must be set (or pass host/user/password)",
      );
    }
    return { host, user, password };
  }

  private resolveSmtpConfig(creds: { user: string; password: string }): SmtpConfig {
    const host = this.config.smtpHost ?? process.env.EMAIL_SMTP_HOST ?? creds.user.split("@")[1];
    if (!host) {
      throw new Error("EmailChannel: could not determine SMTP host (set EMAIL_SMTP_HOST)");
    }
    return {
      host,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      user: creds.user,
      pass: creds.password,
    };
  }

  async listen(agent: PhusAgent): Promise<void> {
    if (this.closed) {
      throw new Error("EmailChannel has already been closed");
    }
    this.agent = agent;

    const creds = this.resolveCredentials();
    logger.info("channel.email.listening", { host: creds.host, user: creds.user, mailbox: this.config.mailbox });

    await this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalSeconds * 1000);
  }

  private async pollOnce(): Promise<void> {
    if (this.closed) return;
    this.pollCount++;
    const creds = this.resolveCredentials();

    try {
      const messages = await fetchUnseenMessages({
        host: creds.host,
        user: creds.user,
        password: creds.password,
        port: this.config.imapPort,
        tls: this.config.tls,
        mailbox: this.config.mailbox,
        lastUid: this.lastUid,
      });

      for (const msg of messages) {
        if (this.seenUids.has(msg.uid)) continue;
        this.seenUids.add(msg.uid);
        if (msg.uid > this.lastUid) this.lastUid = msg.uid;

        const envelope = makeEnvelopeFromChat({
          channel: this.name,
          chatId: msg.messageId ?? String(msg.uid),
          from: msg.from?.address ?? msg.from?.text ?? "unknown",
          content: `Subject: ${msg.subject ?? "(no subject)"}\n\n${msg.text ?? ""}`,
          replyTo: String(msg.uid),
          metadata: {
            to: msg.to,
            uid: msg.uid,
            subject: msg.subject,
            messageId: msg.messageId,
            replyToAddress: msg.from?.address,
          },
          address: this.buildAddress(
            { messageId: msg.messageId, inReplyTo: msg.inReplyTo, references: msg.references },
            msg.from?.address ?? msg.from?.text ?? "unknown",
          ),
          subjectId: msg.from?.address,
          displayName: msg.from?.text,
        });

        try {
          await this.agent?.turn(envelope, this);
        } catch (err: any) {
          logger.error("channel.email.turn_failed", { uid: msg.uid, error: err?.message ?? err });
        }
      }
    } catch (err: any) {
      logger.error("channel.email.poll_failed", { error: err?.message ?? err });
    }
  }

  async send(outbounds: Outbound[]): Promise<void> {
    const creds = this.resolveCredentials();
    const smtp = this.resolveSmtpConfig(creds);
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    for (const msg of outbounds) {
      if (msg.type !== "text") continue;
      const metadata = (msg.metadata ?? {}) as Record<string, unknown>;
      const to = typeof metadata.replyToAddress === "string"
        ? metadata.replyToAddress
        : msg.to;
      const subject = typeof metadata.subject === "string"
        ? `Re: ${metadata.subject.replace(/^Re: /i, "")}`
        : "Re: Phus";

      try {
        await transporter.sendMail({
          from: `"Phus" <${creds.user}>`,
          to,
          subject,
          text: msg.content,
          inReplyTo: typeof metadata.messageId === "string" ? metadata.messageId : undefined,
        });
      } catch (err: any) {
        logger.error("channel.email.send_failed", { to, error: err?.message ?? err });
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  status(): ChannelStatus {
    return {
      name: this.name,
      listening: !this.closed && this.pollCount > 0,
      connected: !this.closed && this.pollCount > 0 ? 1 : 0,
      details: {
        pollCount: this.pollCount,
        seenUids: this.seenUids.size,
      },
    };
  }

  private buildAddress(parsed: EmailThreadHeaders, fromAddress: string): SessionAddress {
    const rootId = deriveEmailThreadRootId(parsed);
    return {
      channel: "email",
      scope: `mailbox:${this.config.mailbox ?? "INBOX"}`,
      conversationKey: rootId ? `thread:${rootId}` : `from:${fromAddress}`,
      threadKey: parsed.messageId && parsed.messageId !== rootId
        ? `msg:${parsed.messageId}`
        : undefined,
    };
  }
}

interface FetchedMessage {
  uid: number;
  messageId?: string;
  subject?: string;
  from?: { address?: string; text?: string };
  to?: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface EmailThreadHeaders {
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** Return the most stable id for an email thread:
 *   references[0] is the original message id in RFC 5322 chains,
 *   inReplyTo is the direct parent (one-step link),
 *   messageId is the start of a new thread. */
export function deriveEmailThreadRootId(parsed: EmailThreadHeaders): string {
  if (parsed.references && parsed.references.length > 0) {
    return parsed.references[0]!;
  }
  if (parsed.inReplyTo) return parsed.inReplyTo;
  return parsed.messageId ?? "";
}

function fetchUnseenMessages(opts: {
  host: string;
  user: string;
  password: string;
  port: number;
  tls: boolean;
  mailbox: string;
  lastUid: number;
}): Promise<FetchedMessage[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: opts.host,
      user: opts.user,
      password: opts.password,
      port: opts.port,
      tls: opts.tls,
    });

    const messages: FetchedMessage[] = [];

    imap.once("ready", () => {
      imap.openBox(opts.mailbox, false, (err) => {
        if (err) {
          imap.end();
          reject(err);
          return;
        }
        imap.search([["UID", `${opts.lastUid + 1}:*`]], (searchErr, results) => {
          if (searchErr) {
            imap.end();
            reject(searchErr);
            return;
          }
          if (!results || results.length === 0) {
            imap.end();
            resolve([]);
            return;
          }
          const fetch = imap.fetch(results, { bodies: "" });
          fetch.on("message", (msg, seqno) => {
            let uid = 0;
            let body = Buffer.alloc(0);
            msg.on("body", (stream) => {
              stream.on("data", (chunk: Buffer) => {
                body = Buffer.concat([body, chunk]);
              });
            });
            msg.once("attributes", (attrs) => {
              uid = attrs.uid;
            });
            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(body);
                messages.push({
                  uid,
                  messageId: parsed.messageId ?? undefined,
                  subject: parsed.subject ?? undefined,
                  from: parsed.from?.value[0]
                    ? { address: parsed.from.value[0].address, text: parsed.from.text }
                    : undefined,
                  to: Array.isArray(parsed.to)
                    ? parsed.to.map((a: any) => a.text).join(", ")
                    : parsed.to?.text,
                  text: parsed.text ?? undefined,
                  inReplyTo: parsed.inReplyTo ?? undefined,
                  references: Array.isArray(parsed.references)
                    ? parsed.references
                    : (typeof parsed.references === "string" && parsed.references
                      ? parsed.references.split(/\s+/).filter(Boolean)
                      : undefined),
                });
              } catch (parseErr: any) {
                logger.warn("channel.email.parse_failed", { seqno, error: parseErr.message });
              }
            });
          });
          fetch.once("error", (fetchErr) => {
            imap.end();
            reject(fetchErr);
          });
          fetch.once("end", () => {
            imap.end();
          });
        });
      });
    });

    imap.once("error", (err) => reject(err));
    imap.once("end", () => resolve(messages));
    imap.connect();
  });
}
