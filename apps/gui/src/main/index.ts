// apps/gui/src/main/index.ts
// Electron main process entry. Owns:
//   - app lifecycle (BrowserWindow, quit handling)
//   - log path redirection to userData (must run before any Phus import)
//   - PhusAgent lifecycle via AgentHost (singleton)
//   - ipcMain handlers that bridge renderer invocations to AgentHost

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redirectPhusPaths } from "./log-paths.js";
import { agentHost } from "./agent-host.js";
import { detectBootstrapState, writeBootstrapConfig } from "./bootstrap.js";
import { registerIpcHandlers, unregisterIpcHandlers } from "./ipc-handlers.js";
import { IpcChannels } from "../shared/ipc-channels.js";
import { Value } from "@sinclair/typebox/value";
import { asSessionId } from "@root/types/brand.js";
import type {
  BootstrapSubmitPayload,
  CheckpointRequestPayload,
  PermissionResponsePayload,
  PlanStepRequestPayload,
  ReflectRequestPayload,
  SetModelRequestPayload,
  SetThinkingRequestPayload,
  SlashRequestPayload,
  TurnRequestPayload,
  EnvelopePayload,
} from "../shared/ipc-schema.js";

// ─── Paths must be set BEFORE importing any Phus module that reads env. ──
// We import Phus lazily (dynamic import) so the env override sticks.
redirectPhusPaths();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIST = join(__dirname, "../renderer");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: "#0b0d10",
    title: "Phus",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(join(RENDERER_DIST, "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Wire every ipcMain.handle channel. Each handler validates the payload
 *  with TypeBox, calls into AgentHost, and returns the result. */
function registerAppIpc(): void {
  const handle = <Req, Res>(
    channel: string,
    schema: Parameters<typeof Value.Check>[0] | null,
    fn: (req: Req) => Promise<Res> | Res,
  ): void => {
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      if (schema && !Value.Check(schema, raw)) {
        const errors = [...Value.Errors(schema, raw)];
        const detail = errors.map((e) => `${e.path || "(root)"}: ${e.message}`).join("; ");
        throw new Error(`invalid payload on ${channel}: ${detail}`);
      }
      return fn(raw as Req);
    });
  };

  // Turn / slash / abort
  handle<EnvelopePayload, void>(IpcChannels.Turn, null, async (envelope) => {
    await agentHost.turn(envelope);
  });
  handle<void, void>(IpcChannels.Abort, null, () => agentHost.abort());
  handle<SlashRequestPayload, void>(IpcChannels.Slash, null, ({ command }) =>
    agentHost.runSlash(command),
  );

  // Permission flow
  handle<PermissionResponsePayload, void>(
    IpcChannels.PermissionResponse,
    null,
    (response) => {
      agentHost.resolvePermission(response);
    },
  );

  // Model / thinking level
  handle<SetModelRequestPayload, void>(IpcChannels.SetModel, null, async ({ modelId, provider }) => {
    await agentHost.setModel(modelId, provider);
  });
  handle<SetThinkingRequestPayload, void>(
    IpcChannels.SetThinkingLevel,
    null,
    ({ level }) => agentHost.setThinkingLevel(level),
  );

  // Skills / conversation / checkpoints
  handle<void, void>(IpcChannels.ReloadSkills, null, () => agentHost.reloadSkills());
  handle<void, void>(IpcChannels.ClearConversation, null, () =>
    agentHost.clearConversation(),
  );
  handle<void, string>(IpcChannels.CompactSession, null, () =>
    agentHost.compactCurrentSession(),
  );
  handle<CheckpointRequestPayload, unknown[]>(IpcChannels.ListCheckpoints, null, ({ sessionId }) =>
    agentHost.listCheckpoints(asSessionId(sessionId)),
  );
  handle<CheckpointRequestPayload, void>(IpcChannels.SaveCheckpoint, null, ({ sessionId }) => {
    agentHost.saveCheckpoint(asSessionId(sessionId));
  });
  handle<CheckpointRequestPayload, void>(IpcChannels.RestoreCheckpoint, null, async ({ sessionId }) => {
    await agentHost.restoreCheckpoint(asSessionId(sessionId));
  });

  // Plan control
  handle<void, string | undefined>(IpcChannels.PausePlan, null, () => agentHost.pauseActivePlan());
  handle<void, string | undefined>(IpcChannels.ResumePlan, null, () =>
    agentHost.resumeActivePlan(),
  );
  handle<void, string | undefined>(IpcChannels.CancelPlan, null, () => agentHost.cancelActivePlan());
  handle<PlanStepRequestPayload, boolean>(IpcChannels.RetryPlanStep, null, ({ planId, stepId }) =>
    agentHost.retryStep(planId, stepId),
  );

  // Skill drafts / reflect
  handle<string, boolean>(IpcChannels.PromoteSkillDraft, null, (name) =>
    agentHost.promoteSkillDraft(name),
  );
  handle<string, boolean>(IpcChannels.ArchiveSkillDraft, null, (name) =>
    agentHost.archiveSkillDraft(name),
  );
  handle<ReflectRequestPayload, unknown>(IpcChannels.Reflect, null, async ({ sessionId, task }) => {
    return agentHost.reflect(sessionId, task);
  });

  // Read-side snapshots
  handle<void, import("../shared/ipc-schema.js").BootstrapStatusPayload>(
    IpcChannels.GetBootstrapStatus,
    null,
    () => detectBootstrapState(),
  );
  handle<void, unknown>(IpcChannels.GetDiagnostics, null, () => agentHost.getDiagnostics());
  handle<void, unknown>(IpcChannels.GetHookReport, null, () => agentHost.getHookReport());
  handle<void, unknown[]>(IpcChannels.GetAllSkills, null, () => agentHost.getAllSkills());
  handle<void, unknown[]>(IpcChannels.GetPolicy, null, () => agentHost.getPolicy());
  handle<void, unknown>(IpcChannels.GetTapeStats, null, () => agentHost.getTapeStats());
  handle<{ sessionId: string | undefined; limit: number }, string>(
    IpcChannels.GetTapeSummary,
    null,
    ({ sessionId, limit }) => agentHost.getTapeSummary(sessionId, limit),
  );
  handle<void, unknown>(IpcChannels.GetAutonomyGate, null, () => agentHost.getAutonomyGate());
  handle<void, unknown>(IpcChannels.GetMemoryStore, null, () => agentHost.getMemoryStore());
  handle<void, number>(IpcChannels.GetMemoryBytes, null, () => agentHost.getMemoryBytes());
  handle<void, unknown[]>(IpcChannels.GetSkillDrafts, null, () => agentHost.getSkillDrafts());
  handle<void, string>(IpcChannels.GetModelLabel, null, () => agentHost.getModelLabel());
  handle<void, string>(IpcChannels.GetThinkingLevel, null, () => agentHost.getThinkingLevel());

  // Wizard bootstrap submit / cancel
  handle<BootstrapSubmitPayload, void>(IpcChannels.BootstrapSubmit, null, async (payload) => {
    await writeBootstrapConfig(payload);
    await agentHost.restart();
  });
  handle<void, void>(IpcChannels.BootstrapCancel, null, () => {
    // No-op for now — renderer just hides its modal. A real "cancel" would
    // quit the app if the agent cannot run without config.
  });
}

/** After the renderer is ready, check whether the user needs to run the
 *  bootstrap or key wizard and broadcast a wizard:show event. */
async function maybeShowWizard(): Promise<void> {
  if (!mainWindow) return;
  const status = await detectBootstrapState();
  if (status.needsBootstrap) {
    mainWindow.webContents.send(IpcChannels.WizardShow, {
      kind: "bootstrap",
      status,
    });
  } else if (status.needsKey) {
    mainWindow.webContents.send(IpcChannels.WizardShow, {
      kind: "key",
      status,
    });
  }
}

async function bootstrapAgent(): Promise<void> {
  try {
    await agentHost.start();
    console.log("[phus-gui] main: agent ready");
    await maybeShowWizard();
  } catch (err) {
    console.error("[phus-gui] main: failed to start agent:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.Error, {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
}

app.whenReady().then(() => {
  console.log("[phus-gui] main: app ready");

  // Logger must be initialized AFTER redirectPhusPaths so the pino
  // destination lands in userData, not cwd.
  void (async (): Promise<void> => {
    const { initLogger } = await import("@root/infra/logging.js");
    const { loadConfig } = await import("@root/infra/config/index.js");
    const config = loadConfig();
    initLogger({ file: config.log.file, level: config.log.level });
  })();

  registerIpcHandlers();
  registerAppIpc();
  console.log("[phus-gui] main: ipc handlers registered");

  createWindow();
  console.log("[phus-gui] main: window created");

  // Start the agent after the window has had a chance to load the
  // preload bridge. We use a short delay rather than `ready-to-show` so
  // the wizard prompt can race the user typing.
  mainWindow?.webContents.once("did-finish-load", () => {
    void bootstrapAgent();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await agentHost.dispose();
  unregisterIpcHandlers();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await agentHost.dispose();
});

// Block the renderer from being navigated away.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    if (VITE_DEV_SERVER_URL && navigationUrl.startsWith(VITE_DEV_SERVER_URL)) return;
    if (navigationUrl.startsWith("file://")) return;
    event.preventDefault();
    void shell.openExternal(navigationUrl);
  });
});