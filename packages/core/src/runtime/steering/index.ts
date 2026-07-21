// src/core/steering.ts
// Bub's SteeringInboxProtocol — a queue of Envelopes that get drained
// and fed to the agent via Pi's steer() mechanism.
//
// Used by:
//   - Heartbeat (Phase B): periodic nudges injected into the agent
//   - Plugins: any external source that wants to push a message without
//     going through a full Channel (e.g., webhook → inbox → agent)
//
// Observability goes through the optional `onLog` callback (defaults to
// no-op). Runtime injects its pino logger wrapper so structured events
// stay in the same stream.

import type { Envelope } from "../../types/channel/index.js";
import { SteeringEvent, SteeringInbox } from "../../types/steering/index.js";

/**
 * Default SteeringInbox: simple FIFO queue.
 * The provider_drain hook fires on every drain for observability.
 */
export class PiSteeringInbox implements SteeringInbox {
	private queue: Envelope[] = [];
	private readonly onLog: (event: string, fields?: Record<string, unknown>) => void;

	constructor(opts: { onLog?: (event: string, fields?: Record<string, unknown>) => void } = {}) {
		this.onLog = opts.onLog ?? (() => {});
	}

	async enqueueMessage(envelope: Envelope, reason?: string): Promise<void> {
		this.queue.push(envelope);
		this.recordEnqueued(envelope.from, this.queue.length, reason);
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
		this.onLog(SteeringEvent.ENQUEUED, { from, reason, depth });
	}

	private recordDrained(count: number) {
		this.onLog(SteeringEvent.DRAINED, { count });
	}
}