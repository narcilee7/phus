import { Envelope, EnvelopType } from "../../types/channel/index.js";

type Messages = Envelope[];

/**
 * sterring box protocol
 */
export interface SteeringInbox {
  enqueueMessage(envelope: Envelope, reason?: string): Promise<void>;
  drainMessages(): Promise<Messages>;
  messageCount(): number;
  /** Peek without removing (for inspection). */
  peek(): Messages;
}

export enum SteeringEvent {
  ENQUEUED = "steering.enqueued",
  DRAINED = "steering.drained",
}
