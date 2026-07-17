// apps/gui/src/main/index.ts
// Electron main process entry. Phus GUI uses a thin shell: it owns one
// PhusAgent (created in-process via @root/bridge/lifecycle.js) and bridges
// every facade call to the renderer through ipcMain.
//
// Phase 0 only wires the BrowserWindow + contextBridge so we can verify
// the scaffold runs. Phase 1 will add AgentHost, Bootstrap flow, and the
// full IPC schema.

import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerIpcHandlers } from "./ipc-handlers.js";

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
      // Block renderer-initiated navigations to anything other than our
      // dev server / packaged renderer. The agent handles its own outbound
      // network calls; the renderer should not.
    },
  });

  // Open external links in the OS browser, never inside the app shell.
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
}

app.whenReady().then(() => {
  console.log("[phus-gui] main: app ready");
  registerIpcHandlers();
  console.log("[phus-gui] main: ipc handlers registered");
  createWindow();
  console.log("[phus-gui] main: window created");

  app.on("activate", () => {
    // macOS: re-create a window when the dock icon is clicked and no other
    // windows are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // macOS apps typically stay open after windows close. Other platforms quit.
  if (process.platform !== "darwin") app.quit();
});

// Block the renderer from being navigated away (e.g. by a malicious link).
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    if (VITE_DEV_SERVER_URL && navigationUrl.startsWith(VITE_DEV_SERVER_URL)) return;
    if (navigationUrl.startsWith("file://")) return;
    event.preventDefault();
    void shell.openExternal(navigationUrl);
  });
});