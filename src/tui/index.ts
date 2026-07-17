// src/tui/index.ts
// `phus tui` — launch the interactive ink-based TUI.

import React from "react";
import { render } from "ink";
import { App } from "@/tui/App.js";
import { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/infra/logging.js";
import { loadConfig, resetConfigCache, configPath } from "@/infra/config/index.js";
import { BootstrapWizard } from "@/tui/components/boot-strap-components/BootstrapWizard.js";
import { KeyWizard } from "@/tui/components/boot-strap-components/KeyWizard.js";
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

async function runKeyWizard(): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      React.createElement(KeyWizard, {
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

  // Config exists but no API key → launch a mini-wizard that only
  // collects the key (env var or inline) and writes it back. We do not
  // re-run the full bootstrap wizard here because it is designed for
  // first-run config creation; editing an existing profile is a
  // different flow.
  if (!profileHasKey()) {
    const configured = await runKeyWizard();
    if (!configured) {
      const profile = resolveProfile(config.profileName, config.providers);
      const envVar = profile.apiKeyEnv
        ? profile.apiKeyEnv
        : `${profile.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      // eslint-disable-next-line no-console
      console.log("[phus] no API key configured.");
      // eslint-disable-next-line no-console
      console.log(`       Add apiKey to ${configPath()} or set:`);
      // eslint-disable-next-line no-console
      console.log(`         export ${envVar}=<your-key>`);
      return;
    }
    resetConfigCache();
    config = loadConfig();
    // Re-check: if the user picked inline but left the field blank,
    // there is still no usable key. Bail out gracefully.
    if (!profileHasKey()) {
      // eslint-disable-next-line no-console
      console.log("[phus] key still missing; aborting.");
      return;
    }
  }

  const handle = await PhusAgent.create({ config });
  // App.tsx currently consumes the concrete `PhusAgent` so it can read
  // internals during the migration to facade. Pass the internals.
  const agent = handle.internals;
  const sessionId = "tui:user";
  const model = agent.getCurrentModel();
  const modelLabel = `${model.provider}/${model.id}`;

  // Enable terminal-level features that improve TUI input handling:
  // bracketed paste (so paste is distinguishable from typing), alternate
  // screen buffer (so the user's scrollback is preserved), and CSI 2026
  // synchronized output (so each render is one atomic update). We install
  // these BEFORE rendering ink, then restore on exit.
  const { enableTerminalModes, restoreTerminalModes } = await import(
    "@/tui/runtime/terminal-modes.js"
  );
  const { installSyncOutput } = await import("@/tui/runtime/sync-output.js");
  const stdout = process.stdout;
  enableTerminalModes(stdout);
  const uninstallSync = installSyncOutput(stdout);

  const restore = () => {
    uninstallSync();
    restoreTerminalModes(stdout);
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    restore();
    process.exit(0);
  });

  const { waitUntilExit } = render(
    React.createElement(App, { agent, sessionId, modelLabel }),
  );

  logger.info("tui.started", { sessionId, model: modelLabel });
  await waitUntilExit();
  restore();
  await handle.dispose();
  logger.info("tui.exited", { sessionId });
}
