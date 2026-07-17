// apps/gui/src/main/ipc-handlers.ts
// Registers request-response IPC handlers. Phase 0 only wires `ping`.

import { ipcMain } from "electron";

export function registerIpcHandlers(): void {
  ipcMain.handle("phus:ping", () => `pong @ ${new Date().toISOString()}`);
}