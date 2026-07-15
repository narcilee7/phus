// src/core/steering.ts
// Bub's SteeringInboxProtocol — a queue of Envelopes that get drained
// and fed to the agent via Pi's steer() mechanism.
//
// Used by:
//   - Heartbeat (Phase B): periodic nudges injected into the agent
//   - Plugins: any external source that wants to push a message without
//     going through a full Channel (e.g., webhook → inbox → agent)

import type { Envelope } from "./types.js";
import { logger } from "./logger.js";

export interface SteeringInbox {
  enqueueMessage(envelope: Envelope, reason?: string): Promise<void>;
  drainMessages(): Promise<Envelope[]>;
  messageCount(): number;
  /** Peek without removing (for inspection). */
  peek(): Envelope[];
}

/**
 * Default SteeringInbox: simple FIFO queue.
 * The provider_drain hook fires on every drain for observability.
 */
export class PiSteeringInbox implements SteeringInbox {
  private queue: Envelope[] = [];

  async enqueueMessage(envelope: Envelope, reason?: string): Promise<void> {
    this.queue.push(envelope);
    logger.debug("steering.enqueued", {
      from: envelope.from,
      reason,
      depth: this.queue.length,
    });
  }

  async drainMessages(): Promise<Envelope[]> {
    if (this.queue.length === 0) return [];
    const drained = this.queue;
    this.queue = [];
    logger.debug("steering.drained", { count: drained.length });
    return drained;
  }

  messageCount(): number {
    return this.queue.length;
  }

  peek(): Envelope[] {
    return [...this.queue];
  }
}

/** Singleton for the default case. Reset on each gateway restart if needed. */
let defaultInbox: PiSteeringInbox | undefined;

export function getDefaultInbox(): PiSteeringInbox {
  if (!defaultInbox) defaultInbox = new PiSteeringInbox();
  return defaultInbox;
}

export function resetDefaultInbox(): void {
  defaultInbox = undefined;
}
