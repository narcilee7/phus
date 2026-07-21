// src/tui/components/session-components/SessionsPanel.ts
// Ctrl+B sessions sidebar: tape sessions from `agent.getTapeStats()`,
// current session marked, ↑↓ navigate, Enter switches (`/use <sid>`),
// Esc / q closes. Mounted like the command palette (above the input
// box, owns focus while open).

import type { Component, Focusable } from "../../vendor/pi-tui/tui.js";
import { SelectList, type SelectListTheme } from "../../vendor/pi-tui/components/select-list.js";
import { colorize } from "../../runtime/text-utils.js";

const THEME: SelectListTheme = {
	selectedPrefix: (s) => colorize(s, "cyan"),
	selectedText: (s) => colorize(s, "cyan", "bold"),
	description: (s) => colorize(s, "dim"),
	scrollInfo: (s) => colorize(s, "dim"),
	noMatch: (s) => colorize(s, "dim"),
};

const MAX_VISIBLE = 8;

export class SessionsPanel implements Component, Focusable {
	focused = false;
	private readonly list: SelectList;

	constructor(
		sessions: Record<string, number>,
		currentSessionId: string | undefined,
		private readonly onPick: (sessionId: string) => void,
		private readonly onClose: () => void,
	) {
		const items = Object.entries(sessions)
			.sort((a, b) => b[1] - a[1])
			.map(([sid, n]) => ({
				value: sid,
				label: sid === currentSessionId ? `${sid} ●` : sid,
				description: `${n} entries`,
			}));
		this.list = new SelectList(items, MAX_VISIBLE, THEME);
		this.list.onSelect = (item) => this.onPick(item.value);
		this.list.onCancel = () => this.onClose();
	}

	focus(): void {
		this.focused = true;
	}
	blur(): void {
		this.focused = false;
	}
	invalidate(): void {}

	handleInput(data: string): void {
		if (data === "q") {
			this.onClose();
			return;
		}
		this.list.handleInput(data);
	}

	render(width: number): string[] {
		const title =
			colorize("⛰ sessions", "bold") +
			colorize("  ·  ↑↓ navigate · Enter open · q / Esc back", "dim");
		return [title, ...this.list.render(width)];
	}
}
