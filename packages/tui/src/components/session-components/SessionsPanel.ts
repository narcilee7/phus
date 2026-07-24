// src/tui/components/session-components/SessionsPanel.ts
// Ctrl+B sessions sidebar: catalog Sessions from `agent.listSessions()`,
// current session marked, ↑↓ navigate, Enter switches (`/use <sid>`),
// `a` archives, `r` reopens, Esc / q closes.

import type { Component, Focusable } from "../../vendor/pi-tui/tui.js";
import { SelectList, type SelectListTheme } from "../../vendor/pi-tui/components/select-list.js";
import { colorize } from "../../runtime/text-utils.js";
import type { Session } from "@phus/core/types/session/index.js";

const THEME: SelectListTheme = {
	selectedPrefix: (s) => colorize(s, "cyan"),
	selectedText: (s) => colorize(s, "cyan", "bold"),
	description: (s) => colorize(s, "dim"),
	scrollInfo: (s) => colorize(s, "dim"),
	noMatch: (s) => colorize(s, "dim"),
};

const MAX_VISIBLE = 10;
const STATUS_MARK: Record<Session["status"], string> = {
	open: "●",
	closed: "○",
	archived: "×",
};

export class SessionsPanel implements Component, Focusable {
	focused = false;
	private readonly list: SelectList;

	constructor(
		sessions: readonly Session[],
		currentSessionId: string | undefined,
		private readonly onPick: (sessionId: string) => void,
		private readonly onClose: () => void,
		private readonly onArchive?: (sessionId: string) => void,
		private readonly onReopen?: (sessionId: string) => void,
	) {
		const items = sessions.map((session) => {
			const mark = STATUS_MARK[session.status] ?? "?";
			const addr = `${session.origin.channel}:${session.origin.scope}:${session.origin.conversationKey}`;
			const thread = session.origin.threadKey ? `:${session.origin.threadKey}` : "";
			const label = `${mark} ${session.id.slice(0, 8)}  ${addr}${thread}${session.id === currentSessionId ? " ←" : ""}`;
			const lastTurn = session.lastTurnAt
				? `last turn ${new Date(session.lastTurnAt).toISOString().slice(11, 19)}`
				: "no turns yet";
			return {
				value: session.id,
				label,
				description: `${session.status} · ${lastTurn}`,
			};
		});
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
		if (data === "q" || data === "\x1b") {
			this.onClose();
			return;
		}
		if (data === "a" || data === "r") {
			const target = this.selectedValue();
			if (target) {
				if (data === "a") this.onArchive?.(target);
				else this.onReopen?.(target);
			}
			return;
		}
		this.list.handleInput(data);
	}

	private selectedValue(): string | undefined {
		// SelectList does not expose a public getter; the rendered
		// selection is reflected via the last onSelectionChange callback
		// or the onSelect payload, but to keep the panel self-contained
		// we read the items directly through the constructor input.
		const index = (this.list as unknown as { selectedIndex?: number }).selectedIndex;
		if (typeof index !== "number") return undefined;
		const items = (this.list as unknown as { items?: Array<{ value: string }> }).items;
		return items?.[index]?.value;
	}

	render(width: number): string[] {
		const title =
			colorize("⛰ sessions", "bold") +
			colorize("  ·  ↑↓ navigate · Enter open · a archive · r reopen · q / Esc back", "dim");
		return [title, ...this.list.render(width)];
	}
}
