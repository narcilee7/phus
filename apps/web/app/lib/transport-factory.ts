"use client";

import { createNoopTransport, type PhusTransport } from "./phus-transport";
import { ElectronTransport, isElectronEnvironment } from "./electron-transport";
import { WebSocketTransport } from "./websocket-transport";

export interface TransportFactoryConfig {
  websocketUrl?: string;
}

export function createTransport(config: TransportFactoryConfig = {}): PhusTransport {
  if (isElectronEnvironment()) {
    return new ElectronTransport();
  }

  const url = config.websocketUrl ?? getDefaultWebSocketUrl();
  if (url) {
    return new WebSocketTransport({ url });
  }

  return createNoopTransport();
}

function getDefaultWebSocketUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${host}/ws`;
}
