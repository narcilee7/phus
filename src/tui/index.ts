// src/tui/index.ts
// `phus tui` — launch the interactive ink-based TUI.

import React from "react";
import { render } from "ink";
import { App } from "@/tui/App.js";
import { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/infra/logging.js";
import { loadConfig, resetConfigCache, configPath } from "@/infra/config/index.js";
import { BootstrapWizard } from "@/tui/components/BootstrapWizard.js";
import { resolveProfile, apiKeyForProfile } from "@/infra/profile.js";

function profileHasKey(): boolean {
  try {
    const config = loadConfig();
    const profile = resolveProfile(config.profileName, config.providers);
    return !!apiKeyForProfile(profile);
  } catch {
    return false;
  }
}

async function runBootstrapWizard(): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      React.createElement(BootstrapWizard, {
        onDone: (success) => {
          unmount();
          resolve(success);
        },
      }),
    );
  });
}

export async function startTui(): Promise<void> {
  let config = loadConfig();

  // No config file yet → run the bootstrap wizard to create one.
  if (!config.source.present) {
    const configured = await runBootstrapWizard();
    if (!configured) {
      // eslint-disable-next-line no-console
      console.log(`[phus] bootstrap cancelled; create ${configPath()} manually to use the TUI.`);
      return;
    }
    resetConfigCache();
    config = loadConfig();
  }

  // Config exists but no API key → run setup wizard to add one.
  if (!profileHasKey()) {
    // eslint-disable-next-line no-console
    console.log("[phus] no API key configured; starting setup wizard...");
    const configured = await runBootstrapWizard();
    if (!configured) {
      // eslint-disable-next-line no-console
      console.log("[phus] setup cancelled. Set an API key to use Phus:");
      // eslint-disable-next-line no-console
      console.log("  export ANTHROPIC_API_KEY=<your-key>");
      return;
    }
    resetConfigCache();
    config = loadConfig();
  }

  const handle = await PhusAgent.create({ config });
  // App.tsx currently consumes the concrete `PhusAgent` so it can read
  // internals during the migration to facade. Pass the internals.
  const agent = handle.internals;
  const sessionId = "tui:user";
  const model = agent.getCurrentModel();
  const modelLabel = `${model.provider}/${model.id}`;

  const { waitUntilExit } = render(
    React.createElement(App, { agent, sessionId, modelLabel }),
  );

  logger.info("tui.started", { sessionId, model: modelLabel });
  await waitUntilExit();
  await handle.dispose();
  logger.info("tui.exited", { sessionId });
}