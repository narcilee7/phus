// src/tui/components/input/InputBox.ts
// Wraps pi-tui's `Editor` as the chat input. Handles focus handoff:
// by default the input box owns focus so keystrokes flow into it;
// when an interactive card (PermissionPanel, palette, sidebar) mounts,
// it calls `releaseFocus()` so the TUI routes input to the new
// component. On close, `claimFocus()` returns focus to the editor.
//
// M4: replaces the old MultiLineInput.tsx (React/ink) entirely.

import { Editor, type EditorTheme } from "../../vendor/pi-tui/components/editor.js";
import {
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "../../vendor/pi-tui/autocomplete.js";
import type { Component, Focusable, TUI } from "../../vendor/pi-tui/tui.js";

export interface InputBoxOptions {
	readonly tui: TUI;
	readonly onSubmit: (text: string) => void;
	readonly onChange?: (text: string) => void;
	readonly placeholder?: string;
	/** Slash commands shown in the `/` autocomplete dropdown. */
	readonly slashCommands?: SlashCommand[];
	/** Base path for `@file` / path completion (defaults to cwd). */
	readonly basePath?: string;
}

export class InputBox implements Component, Focusable {
	private readonly editor: Editor;
	focused = false;

	constructor(opts: InputBoxOptions) {
		const theme: EditorTheme = {
			borderColor: (s: string) => s,
			selectList: {
				selectedPrefix: (s: string) => s,
				selectedText: (s: string) => s,
				description: (s: string) => s,
				scrollInfo: (s: string) => s,
				noMatch: (s: string) => s,
			},
		};
		this.editor = new Editor(opts.tui, theme, { paddingX: 1 });
		this.editor.onSubmit = (text) => {
			if (text.trim()) {
				opts.onSubmit(text);
				this.editor.setText("");
			}
		};
		if (opts.onChange) this.editor.onChange = opts.onChange;
		// Wire the `/` command dropdown + `@file` path completion — the
		// editor supports it natively, it just never had a provider.
		this.editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				opts.slashCommands ?? [],
				opts.basePath ?? process.cwd(),
			),
		);
	}

	focus(): void {
		// Editor implements Focusable via its `focused` field, which the
		// TUI toggles when setFocus is called. We mirror the state here
		// for diagnostics.
		this.focused = true;
	}

	blur(): void {
		this.focused = false;
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	handleInput(data: string): void {
		this.editor.handleInput(data);
	}

	render(width: number): string[] {
		return this.editor.render(width);
	}

	getText(): string {
		return this.editor.getText();
	}

	setText(text: string): void {
		this.editor.setText(text);
	}

	claimFocus(): void {
		this.focus();
	}

	releaseFocus(): void {
		this.blur();
	}

	/** Used by the App to insert @file or /command mentions into the editor. */
	insertText(text: string): void {
		const current = this.editor.getText();
		this.editor.setText(current + text);
	}
}
