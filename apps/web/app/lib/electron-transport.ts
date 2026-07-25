"use client";

import type { AgentMessageChunk, ControlResponse, PhusTransport } from "./phus-transport";

/** Typed window bridge injected by the desktop preload script. */
export interface ElectronAPI {
  sendMessage: (content: string) => Promise<void>;
  abort: () => void;
  onMessage: (handler: (chunk: AgentMessageChunk) => void) => () => void;
  onStatus: (handler: (status: AgentMessageChunk["status"]) => void) => () => void;
  getModelLabel: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Desktop transport that delegates to the Electron IPC bridge exposed by
 * the preload script.
 */
export class ElectronTransport implements PhusTransport {
  readonly name = "electron";

  send(content: string): Promise<void> {
    return window.electronAPI?.sendMessage(content) ?? Promise.resolve();
  }

  async sendControl<T = unknown>(action: string): Promise<ControlResponse<T>> {
    // Desktop IPC does not yet support control requests.
    return { action, error: "not implemented in electron transport" };
  }

  abort(): void {
    window.electronAPI?.abort();
  }

  onMessage(handler: (chunk: AgentMessageChunk) => void): () => void {
    return window.electronAPI?.onMessage(handler) ?? (() => {});
  }

  onStatus(handler: (status: AgentMessageChunk["status"]) => void): () => void {
    return window.electronAPI?.onStatus(handler) ?? (() => {});
  }

  async getModelLabel(): Promise<string> {
    return (await window.electronAPI?.getModelLabel()) ?? "electron/unknown";
  }
}

export function isElectronEnvironment(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
}
