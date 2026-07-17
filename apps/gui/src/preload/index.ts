// apps/gui/src/preload/index.ts
// contextBridge bridge — exposes a typed `window.phus` API to the renderer.
// Phase 0 exposes only `ping()` so the renderer can verify the bridge is
// alive. Phase 1 expands this with the full facade surface.

import { contextBridge, ipcRenderer } from "electron";

const api = {
  /** Round-trip ping for verifying the IPC bridge is wired. */
  ping: (): Promise<string> => ipcRenderer.invoke("phus:ping"),

  /** Subscribe to main → renderer broadcasts. Returns an unsubscribe fn. */
  on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
} as const;

export type PhusPreloadApi = typeof api;

contextBridge.exposeInMainWorld("phus", api);