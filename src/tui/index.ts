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

  const { waitUntilExit } = render(
    React.createElement(App, { agent, sessionId }),
  );

  logger.info("tui.started", { sessionId });
  await waitUntilExit();
  logger.info("tui.exited", { sessionId });
}
