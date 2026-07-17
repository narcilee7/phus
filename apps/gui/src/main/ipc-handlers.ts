// apps/gui/src/main/ipc-handlers.ts
// Minimal ping/healthcheck handler. All real facade IPC is registered by
// registerAppIpc() in main/index.ts, but `ping` stays here because it's a
// no-deps smoke test used by the renderer Phase-0 placeholder and the
// vitest smoke tests.

import { ipcMain } from "electron";

export function registerIpcHandlers(): void {
  ipcMain.handle("phus:ping", () => `pong @ ${new Date().toISOString()}`);
}

export function unregisterIpcHandlers(): void {
  ipcMain.removeHandler("phus:ping");
}