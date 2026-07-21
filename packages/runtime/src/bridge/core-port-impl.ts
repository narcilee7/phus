// packages/runtime/src/bridge/core-port-impl.ts
// Default impl of `CorePort` on top of a Pi `Agent` + `Model`.
// Only file in the impl chain that imports Pi types — the rest of the
// runtime sees CorePort only.

import {
	type Agent,
	type AgentEvent,
	type AgentMessage,
} from "@mariozechner/pi-agent-core";
import { completeSimple, type Model } from "@mariozechner/pi-ai";

import { getLlmFuse } from "../infra/profile.js";
import { extractText } from "./text.js";
import type {
	CoreAgentEvent,
	CoreAgentLike,
	CoreCompletion,
	CoreMessage,
	CorePort,
} from "./core-port.js";

/** Map a CoreMessage to Pi's AgentMessage union. */
function toAgentMessage(m: CoreMessage): AgentMessage {
	if (m.role === "toolResult") {
		return {
			role: "toolResult",
			toolCallId: m.toolCallId!,
			toolName: m.toolName!,
			content: [{ type: "text", text: m.content }],
			isError: !!m.isError,
			timestamp: Date.now(),
		} as AgentMessage;
	}
	return {
		role: m.role,
		content: [{ type: "text", text: m.content }],
		timestamp: Date.now(),
	} as AgentMessage;
}

/** Map Pi's AgentMessage[] back to CoreMessage[]. Used to translate
 *  agent_end payloads so core never sees a Pi type. */
function fromAgentMessages(msgs: AgentMessage[]): CoreMessage[] {
	return msgs.map((m) => {
		// Tool-result messages carry toolName + isError metadata.
		if ((m as any).role === "toolResult") {
			const content: any[] = Array.isArray((m as any).content)
				? ((m as any).content as any[])
				: [];
			const text = content
				.filter((c) => c?.type === "text")
				.map((c) => c.text)
				.join("");
			return {
				role: "toolResult",
				content: text,
				toolName: (m as any).toolName,
				toolCallId: (m as any).toolCallId,
				isError: !!(m as any).isError,
			};
		}
		const content: any[] = Array.isArray((m as any).content)
			? ((m as any).content as any[])
			: [];
		const text = content
			.filter((c) => c?.type === "text")
			.map((c) => c.text)
			.join("");
		return { role: (m as any).role, content: text };
	});
}

/** Extract the assistant text from a list of CoreMessages. Lives next
 *  to extractText for symmetry. */
export function extractLastAssistantText(messages: CoreMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "assistant") return m.content;
	}
	return "";
}

/** Build a CorePort that drives the given Pi Agent + Model.
 *  Session-id get/set is delegated to PhusAgent (which owns the
 *  currentSessionId field) — the underlying Pi Agent doesn't expose
 *  those methods. */
export function createDefaultCorePort(
	piAgent: Agent,
	model: Model<any>,
	session: {
		getCurrentSessionId(): string | undefined;
		setNextSessionId(id: string): void;
	},
): CorePort {
	const agent: CoreAgentLike = {
		steer: (m) => piAgent.steer(toAgentMessage(m)),
		waitForIdle: () => piAgent.waitForIdle(),
		abort: () => piAgent.abort(),
		subscribeToAgentEvents: (handler) =>
			piAgent.subscribe((event: AgentEvent) => {
				if (event.type === "agent_end") {
					const payload: CoreAgentEvent = {
						type: "agent_end",
						messages: fromAgentMessages(event.messages),
					};
					handler(payload);
				}
			}),
		setNextSessionId: session.setNextSessionId,
		getCurrentSessionId: session.getCurrentSessionId,
	};

	const complete = async (prompt: CoreMessage[]): Promise<CoreCompletion> => {
		try {
			const assistant = await completeSimple(model, {
				messages: prompt.map(toAgentMessage) as any,
			});
			return { text: extractText(assistant as any) };
		} catch (err) {
			// Mirror planner-model: classify failures so the billing fuse can trip.
			getLlmFuse().report(err);
			throw err;
		}
	};

	return { complete, promptStream: complete, agent };
}
