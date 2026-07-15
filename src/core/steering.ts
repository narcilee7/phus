// src/core/steering.ts
// Bub's SteeringInboxProtocol — a queue of Envelopes that get drained
// and fed to the agent via Pi's steer() mechanism.
//
// Used by:
//   - Heartbeat (Phase B): periodic nudges injected into the agent
//   - Plugins: any external source that wants to push a message without
//     going through a full Channel (e.g., webhook → inbox → agent)

import type { Envelope } from "@/types/channel/index.js";
import { logger } from "@/core/logger.js";
import { SteeringEvent, SteeringInbox } from "@/types/steering/index.js";

/**
 * Default SteeringInbox: simple FIFO queue.
 * The provider_drain hook fires on every drain for observability.
 */
export class PiSteeringInbox implements SteeringInbox {
  private queue: Envelope[] = [];

  async enqueueMessage(envelope: Envelope, reason?: string): Promise<void> {
    this.queue.push(envelope);
    this.recordEnqueued(
      envelope.from,
      this.queue.length,
      reason,
    )
  }

  async drainMessages(): Promise<Envelope[]> {
    if (this.queue.length === 0) return [];
    const drained = this.queue;
    this.queue = [];
    this.queue.length = 0;
    this.recordDrained(drained.length);
    return drained;
  }

  messageCount(): number {
    return this.queue.length;
  }

  peek(): Envelope[] {
    return [...this.queue];
  }

  private recordEnqueued(from: string, depth: number, reason?: string) {
    logger.debug(SteeringEvent.ENQUEUED, {
      from: from,
      reason,
      depth: depth,
    });
  }

  private recordDrained(count: number) {
    logger.debug(SteeringEvent.DRAINED, { count });
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
