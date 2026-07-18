// src/tui/components/permission/PermissionPanel.ts
// Multi-row panel for Y/S/A/N permission prompts. Display-only by
// default; in M3 we add a `resolve` callback that the App wires via
// the dispatch action.
//
// M3 surface: Focusable + Y/S/A/N/Esc/Enter keybindings routed to
// the `onResolve` callback supplied by the App.

import type { Component, Focusable } from "@/vendor/pi-tui/tui.js";
import type { PermissionRequest } from "@/state/state.js";
import { box } from "@/runtime/border.js";
import { colorize, wrapTextWithAnsi } from "@/runtime/text-utils.js";

export class PermissionPanel implements Component, Focusable {
	focused = false;
	constructor(
		private readonly request: PermissionRequest,
		private readonly onResolve: (allow: boolean, remember: "once" | "session" | "always") => void,
	) {}

	focus(): void {
		this.focused = true;
	}
	blur(): void {
		this.focused = false;
	}
	invalidate(): void {}

	handleInput(data: string): void {
		const k = data.toLowerCase();
		if (k === "y" || data === "\r") return this.onResolve(true, "once");
		if (k === "n" || k === "\x1b") return this.onResolve(false, "once");
		if (k === "s") return this.onResolve(true, "session");
		if (k === "a") return this.onResolve(true, "always");
	}

	render(width: number): string[] {
		const headerLine = colorize(
			`! ${this.request.toolName} · ${this.request.caption ?? "approve this tool call?"}`,
			"yellow",
			"bold",
		);
		const argPreview = formatArgs(this.request.args, width - 4);
		const previewLines = this.request.preview
			? wrapTextWithAnsi(this.request.preview, width - 4)
			: argPreview;
		const body = [
			headerLine,
			colorize("─".repeat(Math.max(8, width - 4)), "dim"),
			...previewLines.slice(0, 4),
			colorize("[Y]es  [N]o  [S]ession  [A]lways  [Esc] cancel", "dim"),
		];
		return box(body, "single", width, this.focused ? "cyan" : "yellow");
	}
}

function formatArgs(args: unknown, width: number): string[] {
	let text: string;
	try {
		text = JSON.stringify(args, null, 2);
	} catch {
		text = String(args);
	}
	const wrapped = wrapTextWithAnsi(text, Math.max(1, width));
	return wrapped.slice(0, 4);
}
