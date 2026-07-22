// packages/runtime/src/bridge/core-port.ts
// Injection port that lets `core/*` talk to the LLM without importing
// `@mariozechner/pi-ai` or `@mariozechner/pi-agent-core`. Concrete impl
// lives in `core-port-impl.ts`. `core/*` depends on this file only.
//
// Boundary properties:
//  1. No Pi types in this surface. CoreMessage is structurally a tiny
//     subset of AgentMessage; runtime's `createDefaultCorePort` maps
//     CoreMessage <-> AgentMessage at the boundary.
//  2. The impl satisfies the structural type PhusAgent uses; no cast
//     needed.

/** Plain message shape core can build without knowing Pi's AgentMessage.
 *  Content is flattened text; tool messages round-trip toolCallId + isError. */
export interface CoreMessage {
	role: "user" | "assistant" | "system" | "toolResult";
	/** Flattened text content. */
	content: string;
	/** Tool messages carry these; ignored for plain user/assistant/system. */
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
}

/** Result of one LLM completion. Text only — core never inspects Pi's
 *  stopReason / usage / AssistantMessageEventStream. */
export interface CoreCompletion {
	text: string;
}

/** A small slice of agent_end used by sub-agent / learner capture. */
export interface CoreAgentEvent {
	type: "agent_end";
	/** Plain messages we can serialize without a Pi import. */
	messages: CoreMessage[];
}

export type CoreAgentEventHandler = (event: CoreAgentEvent) => void;

/** Surface used by SubAgent to dispatch onto the live Pi loop. */
export interface CoreAgentLike {
	/** Queue a steering message into the live Pi agent loop. */
	steer(message: CoreMessage): void;
	/** Wait for the current turn to finish. */
	waitForIdle(): Promise<void>;
	/** Subscribe; returns unsubscribe. Only `agent_end` events fire. */
	subscribeToAgentEvents(handler: CoreAgentEventHandler): () => void;
	/** Optional — used by sub-agent timeout. */
	abort?(): void;
	/** Set the next session id the Pi loop will use. */
	setNextSessionId(id: string): void;
	/** Read the current session id the Pi loop is on. */
	getCurrentSessionId(): string | undefined;
}

/** The full injection port. The runtime ships one default impl built on
 *  top of `createDefaultCorePort(piAgent, model)`. `core/*` never sees
 *  the impl — only this structural type. */
export interface CorePort {
	/** Single-shot completion for planner / verifier / learner / summarizer. */
	complete(prompt: CoreMessage[], signal?: AbortSignal): Promise<CoreCompletion>;
	/** Streaming-friendly prompt. Defaults to `complete` when not overridden. */
	promptStream?(prompt: CoreMessage[], signal?: AbortSignal): Promise<CoreCompletion>;
	/** Used by SubAgent to dispatch onto the live Pi loop. */
	agent: CoreAgentLike;
}
