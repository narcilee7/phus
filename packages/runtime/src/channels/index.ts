// src/channels/index.ts
// Barrel export for all built-in Phus channels.

export type { ChannelAdapter, ChannelStatus } from "./base.js";
export { makeTextEnvelope, makeEnvelopeFromChat } from "./base.js";
export { CLIChannel, runOnce } from "./cli.js";
export { WebSocketChannel } from "./websocket.js";
export { SSEChannel } from "./sse.js";
export { TelegramChannel } from "./telegram.js";
