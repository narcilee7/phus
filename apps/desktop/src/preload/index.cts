import { contextBridge, ipcRenderer } from "electron";

/** Mirror of the renderer's AgentMessageChunk shape. */
export interface AgentMessageChunk {
  type: "text" | "tool_call" | "tool_result" | "error" | "status";
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { id: string; output: unknown };
  status?: "connected" | "disconnected" | "idle" | "busy";
  error?: string;
}

/**
 * Minimal, typed IPC bridge exposed to the Next.js renderer.
 *
 * This must stay small: only message sending, abort, event streaming,
 * and a few read-only diagnostics cross the context boundary.
 */
const electronAPI = {
  sendMessage: (content: string) => ipcRenderer.invoke("phus:send-message", content),
  abort: () => ipcRenderer.send("phus:abort"),
  getModelLabel: () => ipcRenderer.invoke("phus:get-model-label") as Promise<string>,
  onMessage: (handler: (chunk: AgentMessageChunk) => void) => {
    const wrapper = (_event: Electron.IpcRendererEvent, chunk: AgentMessageChunk) =>
      handler(chunk);
    ipcRenderer.on("phus:message", wrapper);
    return () => {
      ipcRenderer.removeListener("phus:message", wrapper);
    };
  },
  onStatus: (handler: (status: AgentMessageChunk["status"]) => void) => {
    const wrapper = (_event: Electron.IpcRendererEvent, status: AgentMessageChunk["status"]) =>
      handler(status);
    ipcRenderer.on("phus:status", wrapper);
    return () => {
      ipcRenderer.removeListener("phus:status", wrapper);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
