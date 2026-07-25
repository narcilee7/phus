import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const preloadPath = path.resolve(__dirname, "../preload/index.cjs");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Phus Workbench",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // In development, load from the Next.js dev server so the renderer can
  // be hot-reloaded. In production, load the static export from @phus/web.
  if (process.env.PHUS_DESKTOP_DEV_URL) {
    void win.loadURL(process.env.PHUS_DESKTOP_DEV_URL);
    win.webContents.openDevTools();
  } else {
    const indexHtml = path.resolve(__dirname, "../../../web/dist/index.html");
    void win.loadFile(indexHtml);
  }

  return win;
}
