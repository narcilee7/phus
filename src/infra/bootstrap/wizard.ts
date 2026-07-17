// src/infra/bootstrap/wizard.ts
// CLI setup wizard for `phus setup`. Walks the user through provider,
// model, API key, and channel configuration, then writes phus.config.yaml.

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";
import type { ResolvedConfig } from "@/infra/config/index.js";
import { resetConfigCache } from "@/infra/config/index.js";
import { logger } from "@/infra/logging.js";

export type LoadedConfig = ResolvedConfig;

export interface WizardDeps {
  config: LoadedConfig;
  writeConfig: (config: LoadedConfig) => Promise<void>;
}

interface WizardAnswers {
  provider: string;
  modelId: string;
  apiKeyEnv: string;
  profileName: string;
  channels: {
    telegram?: boolean;
    slack?: boolean;
    email?: boolean;
    whatsapp?: boolean;
    websocket?: boolean;
    sse?: boolean;
  };
  telegramToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  emailHost?: string;
  emailUser?: string;
  emailPassword?: string;
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function pickOne(rl: readline.Interface, prompt: string, items: string[]): Promise<string> {
  console.log(prompt);
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  const raw = await ask(rl, "Select (number or name): ");
  const idx = parseInt(raw, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= items.length) return items[idx - 1]!;
  if (items.includes(raw)) return raw;
  console.log("Invalid selection, using first option.");
  return items[0]!;
}

async function askYesNo(rl: readline.Interface, prompt: string): Promise<boolean> {
  const raw = await ask(rl, `${prompt} (y/n): `);
  return raw.trim().toLowerCase().startsWith("y");
}

export async function runSetupWizard(_deps: WizardDeps): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const { getProviders, getModels } = await import("@mariozechner/pi-ai");
    const providers = getProviders();
    const provider = await pickOne(rl, "Choose a provider:", providers);

    const models = getModels(provider as any).map((m) => m.id);
    const modelId = await pickOne(rl, `Choose a model for ${provider}:`, models);

    const apiKeyEnv = await ask(rl, `API key env var for ${provider} (e.g. ${provider.toUpperCase()}_API_KEY): `);
    const profileName = (await ask(rl, "Profile name [default]: ")).trim() || "default";

    console.log("\nEnable channels:");
    const channels: WizardAnswers["channels"] = {};
    const answers: WizardAnswers = {
      provider,
      modelId,
      apiKeyEnv: apiKeyEnv.trim(),
      profileName,
      channels,
    };

    channels.telegram = await askYesNo(rl, "Telegram");
    if (channels.telegram) {
      answers.telegramToken = await ask(rl, "Telegram bot token: ");
    }

    channels.slack = await askYesNo(rl, "Slack");
    if (channels.slack) {
      answers.slackBotToken = await ask(rl, "Slack bot token (xoxb-...): ");
      answers.slackAppToken = await ask(rl, "Slack app token (xapp-...): ");
    }

    channels.email = await askYesNo(rl, "Email");
    if (channels.email) {
      answers.emailHost = await ask(rl, "IMAP host: ");
      answers.emailUser = await ask(rl, "Email user: ");
      answers.emailPassword = await ask(rl, "Email password: ");
    }

    channels.whatsapp = await askYesNo(rl, "WhatsApp");
    channels.websocket = await askYesNo(rl, "WebSocket");
    channels.sse = await askYesNo(rl, "SSE");

    // Lightweight model ping: resolve model + verify key presence.
    const pingOk = await pingModel(provider, modelId, answers.apiKeyEnv);
    console.log(pingOk ? "✓ Model configuration looks valid." : "⚠ Could not validate model configuration.");

    const config = buildConfig(answers);
    await writeConfigFile(_deps.config.paths.home, config);
    console.log(`✓ Config written to ${path.join(_deps.config.paths.home, "phus.config.yaml")}`);
  } finally {
    rl.close();
  }
}

async function pingModel(provider: string, modelId: string, apiKeyEnv: string): Promise<boolean> {
  try {
    const { resolveAndCache } = await import("@/infra/config/index.js");
    resolveAndCache({ provider, modelId });
    if (apiKeyEnv && !process.env[apiKeyEnv]) {
      logger.warn("setup.wizard.key_missing", { env: apiKeyEnv });
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn("setup.wizard.ping_failed", { error: err.message });
    return false;
  }
}

function buildConfig(answers: WizardAnswers): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    provider: answers.provider,
    modelId: answers.modelId,
    thinkingLevel: "medium",
  };
  if (answers.apiKeyEnv) profile.apiKeyEnv = answers.apiKeyEnv;

  const channels: Record<string, unknown>[] = [];
  if (answers.channels.telegram) {
    channels.push({ type: "telegram", token: answers.telegramToken ?? "${TELEGRAM_TOKEN}" });
  }
  if (answers.channels.slack) {
    channels.push({
      type: "slack",
      botToken: answers.slackBotToken ?? "${SLACK_BOT_TOKEN}",
      appToken: answers.slackAppToken ?? "${SLACK_APP_TOKEN}",
    });
  }
  if (answers.channels.email) {
    channels.push({
      type: "email",
      host: answers.emailHost ?? "${EMAIL_HOST}",
      user: answers.emailUser ?? "${EMAIL_USER}",
      password: answers.emailPassword ?? "${EMAIL_PASSWORD}",
    });
  }
  if (answers.channels.whatsapp) channels.push({ type: "whatsapp" });
  if (answers.channels.websocket) channels.push({ type: "websocket", port: 8080 });
  if (answers.channels.sse) channels.push({ type: "sse", port: 8081 });

  const config: Record<string, unknown> = {
    providers: {
      defaultProfile: answers.profileName,
      profiles: { [answers.profileName]: profile },
    },
  };
  if (channels.length > 0) config.channels = channels;
  return config;
}

async function writeConfigFile(home: string, config: Record<string, unknown>): Promise<void> {
  const cfgPath = path.join(home, "phus.config.yaml");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(cfgPath, yaml.stringify(config), "utf-8");
  resetConfigCache();
}
