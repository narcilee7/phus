// src/tui/components/chat/ToolCallCard.ts
// A single `kind: "tool_call"` ChatItem carries the full lifecycle of
// one tool invocation: args (from `upsert_tool_call`) + result /
// isError / durationMs (from `complete_tool_call`). We render the
// pill, an args summary, the formatted result inline, and a DiffView
// for file_write when a pre-write snapshot is available.
//
// M2: passive rendering. M3 will add focus + Enter/Space to toggle
// the result expansion.

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { ChatItem } from "../../state/state.js";
import { colorize, padRight, wrapTextWithAnsi } from "../../runtime/text-utils.js";
import { ToolPill } from "./ToolPill.js";
import { DiffView } from "./DiffView.js";
import { renderMarkdown } from "./Markdown.js";
import { formatToolResult } from "../tool-components/format-result.js";
import type { FileSnapshot } from "./ToolResultCard.js";

export interface ToolCallCardOptions {
	item: ChatItem;
	snapshot?: FileSnapshot;
}

const MAX_PREVIEW_CHARS = 200;

function summarizeArgs(toolName: string | undefined, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const obj = args as Record<string, unknown>;
	switch (toolName) {
		case "bash":
			return String(obj.command ?? "").slice(0, 80);
		case "file_write":
			return String(obj.path ?? "").slice(0, 80);
		case "memory_write": {
			const action = (obj.action as { section?: string } | undefined)?.section;
			return action ? String(action).slice(0, 80) : "";
		}
		default:
			return Object.entries(obj)
				.map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
				.join(", ")
				.slice(0, 80);
	}
}

export class ToolCallCard implements Component {
	constructor(private readonly opts: ToolCallCardOptions) {}

	invalidate(): void {}

	render(width: number): string[] {
		const { item, snapshot } = this.opts;
		const status = item.isError === undefined ? "running" : item.isError ? "error" : "success";
		const pill = new ToolPill(item.toolName ?? "tool", status, item.durationMs).render(width)[0] ?? "";
		const argsSummary = summarizeArgs(item.toolName, item.args);
		const header = argsSummary
			? `${pill}  ${colorize(argsSummary, "dim")}`
			: pill;

		const out: string[] = [padRight(header, width)];

		if (item.toolName === "file_write" && snapshot) {
			const newContent =
				item.args && typeof item.args === "object" && "content" in item.args
					? String((item.args as Record<string, unknown>).content)
					: undefined;
			if (newContent !== undefined && newContent !== snapshot.content) {
				out.push(...new DiffView({ oldText: snapshot.content, newText: newContent }).render(width));
			}
			return out;
		}

		if (item.result !== undefined) {
			const resultText = formatToolResult(item.result);
			if (resultText.length > 0) {
				if (isMarkdownish(resultText)) {
					out.push(...renderMarkdown(resultText, width));
				} else {
					const preview = resultText.length > MAX_PREVIEW_CHARS
						? resultText.slice(0, MAX_PREVIEW_CHARS) + "…"
						: resultText;
					out.push(...wrapTextWithAnsi(preview, width));
				}
			}
		}
		return out;
	}
}

function isMarkdownish(s: string): boolean {
	return /(^|\n)#{1,6}\s|\n```/.test(s);
}
