// src/tui/components/chat/ToolResultCard.ts
// A tool execution result. For file_write, host a DiffView between the
// pre-write snapshot (from the agent's file_snapshots map) and the
// current args.content (passed via the matching tool_call item's args).
// Otherwise render the formatted result as plain text.
//
// M2: passive rendering. M3 will add focus + Enter to toggle expand
// and a/r/e actions for file_write.

import type { Component } from "@/vendor/pi-tui/tui.js";
import type { ChatItem } from "@/state/state.js";
import { colorize, padRight, wrapTextWithAnsi } from "@/runtime/text-utils.js";
import { ToolPill } from "@/components/chat/ToolPill.js";
import { DiffView } from "@/components/chat/DiffView.js";
import { renderMarkdown } from "@/components/chat/Markdown.js";
import { formatToolResult, previewToolResult } from "@/components/tool-components/format-result.js";

export interface FileSnapshot {
	path: string;
	content: string;
}

export class ToolResultCard implements Component {
	constructor(
		private readonly item: ChatItem,
		private readonly args?: unknown,
		private readonly snapshot?: FileSnapshot,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const status = this.item.isError ? "error" : "success";
		const pill = new ToolPill(this.item.toolName ?? "tool", status, this.item.durationMs);
		const out = pill.render(width);

		if (this.item.toolName === "file_write" && this.snapshot) {
			const newContent =
				(this.args as { content?: string } | undefined)?.content ?? this.item.text ?? "";
			if (newContent !== this.snapshot.content) {
				out.push(...new DiffView({ oldText: this.snapshot.content, newText: newContent }).render(width));
				return out;
			}
		}

		const formatted = formatToolResult(this.item.result);
		const preview = previewToolResult(formatted);
		const isMarkdownish = isMarkdown(preview);
		if (isMarkdownish) {
			out.push(...renderMarkdown(preview, width));
		} else {
			const wrapped = wrapTextWithAnsi(preview, width);
			out.push(...wrapped);
		}
		return out;
	}
}

function isMarkdown(s: string): boolean {
	// Heuristic: contains a heading or fence.
	return /(^|\n)#{1,6}\s|\n```/.test(s);
}
