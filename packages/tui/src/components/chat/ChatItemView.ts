// src/tui/components/chat/ChatItemView.ts
// Maps a ChatItem to its rendered string[]. Switches on `kind` and
// delegates to the appropriate sub-component. The viewport passes a
// snapshot map so file_write results can show a diff against the
// pre-write contents.

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { ChatItem } from "../../state/state.js";
import type { FileSnapshot } from "./ToolResultCard.js";
import { UserMessage } from "./UserMessage.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { colorize, wrapTextWithAnsi } from "../../runtime/text-utils.js";

export class ChatItemView implements Component {
	constructor(
		private readonly item: ChatItem,
		private readonly snapshot?: FileSnapshot,
		private readonly stoneFrame?: string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		switch (this.item.kind) {
			case "user":
				return new UserMessage(this.item.text ?? "").render(width);
			case "assistant":
				return new AssistantMessage(this.item, this.stoneFrame).render(width);
			case "tool_call":
				return new ToolCallCard({ item: this.item, snapshot: this.snapshot }).render(width);
			case "tool_result":
				// Legacy kind kept in the union for forward compat. Render
				// the same as a tool_call with snapshot lookup.
				return new ToolCallCard({ item: this.item, snapshot: this.snapshot }).render(width);
			case "system": {
				const level = this.item.level ?? "info";
				const color = level === "error" ? "red" : level === "warn" ? "yellow" : "gray";
				// Multi-line notices (e.g. /help, ,help, /health JSON) must be
				// split + wrapped here: a single string with embedded \n counts
				// as one row in the viewport but occupies many on screen, which
				// corrupts the differential frame.
				const wrapped = wrapTextWithAnsi(
					colorize(this.item.text ?? "", color),
					Math.max(1, width - 2),
				);
				return wrapped.map((line, i) => (i === 0 ? colorize("· ", color) + line : "  " + line));
			}
			default:
				return [colorize(`(unknown item kind: ${(this.item as { kind: string }).kind})`, "red")];
		}
	}
}
