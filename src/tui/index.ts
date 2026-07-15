// src/tui/index.ts
// `phus tui` — launch the interactive ink-based TUI.

import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { PhusAgent } from "../bridge/pi-agent.js";
import { logger } from "../core/logger.js";

export async function startTui(): Promise<void> {
  const agent = new PhusAgent();
  const sessionId = "tui:user";
  const model = agent._internal.piAgent.state.model;
  const modelLabel = `${model.provider}/${model.id}`;

  const { waitUntilExit } = render(
    React.createElement(App, { agent, sessionId, modelLabel }),
  );

  logger.info("tui.started", { sessionId, model: modelLabel });
  await waitUntilExit();
  logger.info("tui.exited", { sessionId });
}
