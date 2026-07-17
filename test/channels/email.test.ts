// test/channels/email.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EmailChannel } from "../../src/channels/email.js";
import type { PhusAgent } from "../../src/bridge/pi-agent.js";

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(),
}));

import * as nodemailer from "nodemailer";

describe("EmailChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASSWORD;
  });

  it("status reports not listening before launch", () => {
    const ch = new EmailChannel({ host: "imap.example.com", user: "u", password: "p" });
    expect(ch.status()).toEqual({
      name: "email",
      listening: false,
      connected: 0,
      details: { pollCount: 0, seenUids: 0 },
    });
  });

  it("throws when credentials are missing", async () => {
    const ch = new EmailChannel();
    await expect(ch.listen({} as PhusAgent)).rejects.toThrow("EMAIL_HOST, EMAIL_USER and EMAIL_PASSWORD");
  });

  it("send routes text outbounds through nodemailer", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    (nodemailer.createTransport as any).mockReturnValue({ sendMail });

    const ch = new EmailChannel({ host: "imap.example.com", user: "phus@example.com", password: "p" });
    await ch.send([
      {
        type: "text",
        content: "reply body",
        to: "sender@example.com",
        channel: "email",
        metadata: {
          subject: "Original",
          messageId: "orig@example.com",
          replyToAddress: "sender@example.com",
        },
      },
      { type: "image", content: "", to: "sender@example.com", channel: "email" },
    ]);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "example.com",
      port: 587,
      secure: false,
      auth: { user: "phus@example.com", pass: "p" },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: '"Phus" <phus@example.com>',
      to: "sender@example.com",
      subject: "Re: Original",
      text: "reply body",
      inReplyTo: "orig@example.com",
    });
  });

  it("send swallows nodemailer errors", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("smtp down"));
    (nodemailer.createTransport as any).mockReturnValue({ sendMail });

    const ch = new EmailChannel({ host: "imap.example.com", user: "phus@example.com", password: "p" });
    await expect(
      ch.send([{ type: "text", content: "x", to: "a@b.com", channel: "email" }]),
    ).resolves.toBeUndefined();
  });

  it("derives SMTP host from user domain when not provided", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    (nodemailer.createTransport as any).mockReturnValue({ sendMail });

    const ch = new EmailChannel({ host: "imap.example.com", user: "phus@example.com", password: "p" });
    await ch.send([{ type: "text", content: "x", to: "a@b.com", channel: "email" }]);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "example.com" }),
    );
  });
});
