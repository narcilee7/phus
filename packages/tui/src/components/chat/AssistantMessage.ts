// src/tui/components/chat/AssistantMessage.ts
// Assistant turn: optional reasoning block (dim), markdown body, optional
// metadata footer (model / tokens / cost).

import type { Component } from "@/vendor/pi-tui/tui.js";
import type { ChatItem } from "@/state/state.js";
import { colorize, wrapTextWithAnsi } from "@/runtime/text-utils.js";
import { renderMarkdown } from "@/components/chat/Markdown.js";

function buildMetadataLine(model?: string, usage?: ChatItem["usage"]): string | undefined {
	const parts: string[] = [];
	if (model) parts.push(model);
	if (usage?.inputTokens != null || usage?.outputTokens != null) {
		const inT = usage.inputTokens ?? 0;
		const outT = usage.outputTokens ?? 0;
		const total = usage.totalTokens ?? inT + outT;
		parts.push(`${inT}→${outT} (${total} tok)`);
	}
	if (usage?.cost != null) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.length === 0 ? undefined : parts.join(" · ");
}

export class AssistantMessage implements Component {
	private readonly item: ChatItem;
	constructor(item: ChatItem) {
		this.item = item;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const out: string[] = [];
		const peak = colorize("●", "cyan");
		if (this.item.isStreaming) {
			out.push(`${peak} ${colorize("streaming…", "dim", "italic")}`);
		}
		if (this.item.reasoning) {
			const reasoning = this.item.reasoning.length > 120
				? this.item.reasoning.slice(0, 117) + "…"
				: this.item.reasoning;
			const wrapped = wrapTextWithAnsi(
				colorize(`💭 ${reasoning.replace(/\n+/g, " ")}`, "dim"),
				width,
			);
			out.push(...wrapped);
		}
		if (this.item.text) {
			out.push(...renderMarkdown(this.item.text, width));
		}
		const meta = buildMetadataLine(this.item.model, this.item.usage);
		if (meta) out.push(colorize(meta, "dim"));
		// Prepend the peak to the first content line.
		if (out.length > 0) out[0] = `${peak} ${out[0]}`;
		return out;
	}
}
