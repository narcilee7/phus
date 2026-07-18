// src/tui/components/command-components/CommandPalette.ts
// Ctrl+K command palette: a filter line over a SelectList of slash
// commands. Takes focus while open; Enter picks (the command is dropped
// into the input box so the user can add args), Esc / Ctrl+C closes.
//
// Kept deliberately small: filtering is prefix-based (SelectList
// semantics), the palette owns no state beyond the filter string.

import type { Component, Focusable } from "@/vendor/pi-tui/tui.js";
import { SelectList, type SelectListTheme } from "@/vendor/pi-tui/components/select-list.js";
import type { SlashCommand } from "@/handler/commands/help.js";
import { colorize } from "@/runtime/text-utils.js";

const THEME: SelectListTheme = {
	selectedPrefix: (s) => colorize(s, "cyan"),
	selectedText: (s) => colorize(s, "cyan", "bold"),
	description: (s) => colorize(s, "dim"),
	scrollInfo: (s) => colorize(s, "dim"),
	noMatch: (s) => colorize(s, "dim"),
};

const MAX_VISIBLE = 10;

export class CommandPalette implements Component, Focusable {
	focused = false;
	private filter = "";
	private readonly list: SelectList;

	constructor(
		commands: SlashCommand[],
		private readonly onPick: (commandName: string) => void,
		private readonly onClose: () => void,
	) {
		const items = commands.map((c) => ({
			value: c.name,
			label: `/${c.name}`,
			description: c.description,
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
		// Printable text (and spaces) extends the filter; everything else
		// (arrows / enter / esc) goes to the list.
		if (data === "\x7f" || data === "\b") {
			this.filter = this.filter.slice(0, -1);
			this.list.setFilter(this.filter);
			return;
		}
		if (data.length === 1 && data >= " ") {
			this.filter += data;
			this.list.setFilter(this.filter);
			return;
		}
		this.list.handleInput(data);
	}

	render(width: number): string[] {
		const prompt = colorize(`⌘ /${this.filter}`, "bold") + colorize("  ·  enter picks · esc closes", "dim");
		return [prompt, ...this.list.render(width)];
	}
}
