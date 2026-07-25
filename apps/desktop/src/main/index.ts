import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createPhusAgent, type PhusAgentHandle } from "@phus/runtime/bridge/lifecycle.js";
import { buildDefaultPhusAgentDeps } from "@phus/runtime/bridge/default-deps.js";
import { makeEnvelopeFromChat } from "@phus/runtime/channels/base.js";
import { loadConfig } from "@phus/runtime/infra/config/index.js";
import type { PhusAgentFacade } from "@phus/runtime/bridge/pi-agent.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { createMainWindow } from "./window.js";
import { createIpcChannel } from "./ipc-channel.js";
import { mapAgentEvent, type AgentMessageChunk } from "./event-mapper.js";

let handle: PhusAgentHandle | undefined;
let agent: PhusAgentFacade | undefined;
let mainWindow: ReturnType<typeof createMainWindow> | undefined;

async function bootstrap(): Promise<void> {
  // Keep Phus home inside the repo root for development so skills/tape land
  // in the same place as the CLI/TUI workflows. __dirname is
  // apps/desktop/dist/main after build; four levels up is the repo root.
  const phusHome = process.env.PHUS_HOME ?? path.resolve(__dirname, "../../../../.phus");
  process.env.PHUS_HOME = phusHome;

  const config = loadConfig();
  const deps = buildDefaultPhusAgentDeps({ config, allowMissingKey: true });
  handle = await createPhusAgent(deps);
  agent = handle.agent;

  mainWindow = createMainWindow();
  const channel = createIpcChannel(mainWindow);

  // Forward agent events to the renderer as typed chunks.
  agent.subscribeToAgentEvents((event: AgentEvent) => {
    const chunk = mapAgentEvent(event);
    if (chunk && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("phus:message", chunk);
      if (chunk.type === "status") {
        mainWindow.webContents.send("phus:status", chunk.status);
      }
    }
  });

  // IPC handlers.
  ipcMain.handle("phus:send-message", async (_event, content: string) => {
    if (!agent) return;

    const envelope = makeEnvelopeFromChat({
      channel: "desktop",
      chatId: "desktop:user",
      content,
      from: "user",
    });

    try {
      await agent.turn(envelope, channel);
    } catch (err: any) {
      const errorChunk: AgentMessageChunk = {
        type: "error",
        error: err?.message ?? String(err),
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("phus:message", errorChunk);
        mainWindow.webContents.send("phus:status", "idle");
      }
    }
  });

  ipcMain.on("phus:abort", () => {
    agent?.abort();
  });

  ipcMain.handle("phus:get-model-label", () => {
    return agent?.getModelLabel() ?? "unknown";
  });
}

async function shutdown(): Promise<void> {
  try {
    await handle?.dispose();
  } catch (err: any) {
    console.error("desktop.shutdown_failed", err?.message ?? err);
  }
}

app.whenReady().then(() => {
  void bootstrap();

  app.on("activate", () => {
    if (mainWindow === undefined) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void shutdown().then(() => app.quit());
  }
});

app.on("before-quit", () => {
  void shutdown();
});

app.on("quit", () => {
  void shutdown();
});
