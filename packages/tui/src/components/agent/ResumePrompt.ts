// src/tui/components/agent/ResumePrompt.ts
// Startup prompt for durable plans: plans are first-class citizens
// that survive the process, so when the TUI starts and finds paused
// (interrupted or deliberately paused) plans, it offers an explicit
// choice — resume / abandon / dismiss — instead of silently
// resurrecting them on the next message (the old implicit-resume bug).

import type { Component, Focusable } from "../../vendor/pi-tui/tui.js";
import { SelectList, type SelectListTheme } from "../../vendor/pi-tui/components/select-list.js";
import type { Plan } from "@phus/runtime/core/runtime/plan/types.js";
import { colorize } from "../../runtime/text-utils.js";

const THEME: SelectListTheme = {
	selectedPrefix: (s) => colorize(s, "cyan"),
	selectedText: (s) => colorize(s, "cyan", "bold"),
	description: (s) => colorize(s, "dim"),
	scrollInfo: (s) => colorize(s, "dim"),
	noMatch: (s) => colorize(s, "dim"),
};

const MAX_VISIBLE = 5;

function age(ts: number): string {
	const minutes = Math.floor((Date.now() - ts) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export class ResumePrompt implements Component, Focusable {
	focused = false;
	private readonly list: SelectList;

	constructor(
		plans: Plan[],
		private readonly onResume: (planId: string) => void,
		private readonly onAbandon: (planId: string) => void,
		private readonly onClose: () => void,
	) {
		const items = plans.map((p) => {
			const done = p.steps.filter((s) => s.status === "completed").length;
			return {
				value: p.id,
				label: p.goal.length > 60 ? `${p.goal.slice(0, 57)}…` : p.goal,
				description: `${done}/${p.steps.length} steps · ${p.sessionId} · ${age(p.updatedAt)}`,
			};
		});
		this.list = new SelectList(items, MAX_VISIBLE, THEME);
		this.list.onSelect = (item) => this.onResume(item.value);
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
		if (data === "d" || data === "q") {
			this.onClose();
			return;
		}
		if (data === "x") {
			const selected = this.list.getSelectedItem();
			if (selected) this.onAbandon(selected.value);
			return;
		}
		this.list.handleInput(data);
	}

	render(width: number): string[] {
		const title =
			colorize("⛰ interrupted plans", "bold") +
			colorize("  ·  Enter resume · x abandon · d dismiss", "dim");
		return [title, ...this.list.render(width)];
	}
}
