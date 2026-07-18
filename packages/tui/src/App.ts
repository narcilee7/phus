// src/tui/App.ts
// Root Component of the pi-tui TUI. Owns the AppStore, wires
// dispatch → tui.requestRender(), and lays out Header + chat
// viewport + StatusBar vertically.
//
// M1 (this file): Header + StatusBar + a fixed-height placeholder
// for the chat viewport. No focusable input, no agent subscription.
// M2 replaces the placeholder with the real ChatViewport; M3 adds
// focusable cards (plan/permission/sidebar); M4 swaps the input box
// and the entry point.

import { Container, type TUI, type Component } from "@/vendor/pi-tui/tui.js";
import { Header, type HeaderStats } from "@/components/base/Header.js";
import { StatusBar } from "@/components/base/StatusBar.js";
import {
	HEADER_ROWS,
	STATUS_ROWS,
	MIN_CHAT_HEIGHT,
} from "@/constants.js";
import { colorize, padRight } from "@/runtime/text-utils.js";
import { createAppStore, type AppStore } from "@/runtime/app-state.js";
import { Spinner } from "@/runtime/spinner.js";

export interface AppDeps {
	readonly sessionId: string;
	readonly modelLabel: string;
}

export class App extends Container {
	private readonly store: AppStore;
	private tui: TUI | undefined;
	private readonly header: Header;
	private readonly statusBar: StatusBar;
	private readonly placeholder = new ChatPlaceholder();
	private readonly spinner = new Spinner();
	private terminalRows = 24;
	private terminalColumns = 80;
	private readonly spinnerUnsub: () => void;

	constructor(deps: AppDeps) {
		super();
		this.store = createAppStore();
		this.header = new Header(deps.modelLabel, deps.sessionId, emptyStats(), "idle");
		this.statusBar = new StatusBar(deps.modelLabel, 0, 0);

		this.addChild(this.header);
		this.addChild(this.placeholder);
		this.addChild(this.statusBar);

		this.spinnerUnsub = this.spinner.onTick(() => this.tui?.requestRender());
	}

	/**
	 * Called once by the entry point after `tui.addChild(app)`. Wires
	 * the store's render trigger and snapshots the terminal size.
	 */
	attach(tui: TUI): void {
		this.tui = tui;
		this.store.setRenderTrigger(() => tui.requestRender());
		this.terminalRows = tui.terminal.rows;
		this.terminalColumns = tui.terminal.columns;
		this.placeholder.setHeight(this.chatHeight());
		this.invalidate();
	}

	chatHeight(): number {
		return Math.max(MIN_CHAT_HEIGHT, this.terminalRows - HEADER_ROWS - STATUS_ROWS);
	}

	invalidate(): void {
		super.invalidate();
		this.header.invalidate();
		this.statusBar.invalidate();
		this.spinner.invalidate();
		if (this.tui) this.placeholder.setHeight(this.chatHeight());
	}

	getSpinner(): Spinner {
		return this.spinner;
	}

	getStore(): AppStore {
		return this.store;
	}
}

function emptyStats(): HeaderStats {
	return { entries: 0, skills: 0, turns: 0, checkpoints: 0 };
}

/**
 * Placeholder for the chat viewport used during M1. Replaced by
 * `components/chat/ChatViewport.ts` in M2. Renders a centered hint
 * over `height` rows.
 */
class ChatPlaceholder implements Component {
	private height = MIN_CHAT_HEIGHT;
	invalidate(): void {}
	setHeight(h: number): void {
		this.height = h;
	}
	render(width: number): string[] {
		const lines: string[] = [];
		const pad = Math.max(0, Math.floor((this.height - 1) / 2));
		for (let i = 0; i < pad; i++) lines.push(padRight("", width));
		lines.push(padRight(centerText(colorize("( chat viewport — wired in M2 )", "gray"), width), width));
		while (lines.length < this.height) lines.push(padRight("", width));
		return lines.slice(0, this.height);
	}
}

function centerText(s: string, width: number): string {
	const visible = [...s].length; // ASCII-only placeholder text
	const v = Math.max(0, Math.floor((width - visible) / 2));
	return " ".repeat(v) + s;
}
