// src/channels/index.ts
// Barrel export for all built-in Phus channels.

export type { ChannelAdapter, ChannelStatus } from "@/channels/base.js";
export { makeTextEnvelope, makeEnvelopeFromChat } from "@/channels/base.js";
export { CLIChannel, runOnce } from "@/channels/cli.js";
export { WebSocketChannel } from "@/channels/websocket.js";
export { SSEChannel } from "@/channels/sse.js";
export { TelegramChannel } from "@/channels/telegram.js";
