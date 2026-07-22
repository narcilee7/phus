// src/tui/components/chat/AssistantMessage.ts
// Assistant turn: optional reasoning block (dim), markdown body, optional
// metadata footer (model / tokens / cost).

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { ChatItem } from "../../state/state.js";
import { colorize, wrapTextWithAnsi } from "../../runtime/text-utils.js";
import { renderMarkdown } from "./Markdown.js";

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
	private readonly stoneFrame: string;
	constructor(item: ChatItem, stoneFrame?: string) {
		this.item = item;
		this.stoneFrame = stoneFrame ?? "●";
	}
	invalidate(): void {}
	render(width: number): string[] {
		const out: string[] = [];
		const peak = colorize("●", "cyan");
		if (this.item.isStreaming) {
			// The stone rolls while tokens stream in. This is a STATUS line —
			// it must not receive the content peak below (that produced the
			// `● ● streaming…` double bullet).
			out.push(
				`${colorize(this.stoneFrame, "cyan")} ${colorize("the stone rolls…", "dim", "italic")}`,
			);
		}
		// Collapsed: first line of text + a one-line hint. Reasoning is
		// hidden entirely when collapsed (it's the loudest, lowest-value
		// part of the assistant item — the model's chain-of-thought that
		// the user typically doesn't want to see unless they ask).
		const text = this.item.text ?? "";
		const textLines = text ? renderMarkdown(text, width) : [];
		if (this.item.collapsed) {
			const first = textLines[0] ?? colorize("(empty reply)", "dim");
			out.push(first);
			out.push(
				colorize(
					`…  Ctrl+O to expand${this.item.reasoning ? " (includes reasoning)" : ""}`,
					"dim",
				),
			);
		} else {
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
			if (text) out.push(...textLines);
		}
		const meta = buildMetadataLine(this.item.model, this.item.usage);
		if (meta && !this.item.collapsed) out.push(colorize(meta, "dim"));
		// Prepend the peak to the first CONTENT line (index 0 normally,
		// index 1 when the streaming status line occupies index 0).
		const firstContent = this.item.isStreaming ? 1 : 0;
		if (out.length > firstContent) out[firstContent] = `${peak} ${out[firstContent]}`;
		return out;
	}
}
