// src/tui/index.ts
// `phus tui` — launch the interactive ink-based TUI.

import React from "react";
import { render } from "ink";
import { App } from "@/tui/App.js";
import { PhusAgent } from "@/bridge/pi-agent.js";
import { logger } from "@/core/logger.js";

export async function startTui(): Promise<void> {
  const handle = await PhusAgent.create();
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