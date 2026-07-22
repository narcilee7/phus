// src/tui/components/agent/PlanPanel.ts
// Active plan visualization. M2: display-only (compact 4-row summary
// that lists step statuses). M3 adds focus + ↑↓/p/r/c/Enter keybindings.

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { PlanState } from "../../state/state.js";
import { box } from "../../runtime/border.js";
import { colorize, padRight, truncateToWidth } from "../../runtime/text-utils.js";

function stepGlyph(s: PlanState["steps"][number]["status"]): { glyph: string; color: string } {
	switch (s) {
		case "completed":
			return { glyph: "✓", color: "green" };
		case "running":
			return { glyph: "▸", color: "cyan" };
		case "failed":
			return { glyph: "✗", color: "red" };
		case "skipped":
			return { glyph: "·", color: "dim" };
		default:
			return { glyph: "○", color: "dim" };
	}
}

export class PlanPanel implements Component {
	constructor(
		private readonly plan: PlanState,
		private readonly expanded: boolean = false,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const titleLine = colorize(`plan · ${colorize(truncateToWidth(this.plan.goal, width - 12, "…"), "bold")} · ${this.plan.status}`, "cyan");
		if (!this.expanded) {
			return box([titleLine, this.progressLine(width)], "round", width, "cyan");
		}
		const rows: string[] = [titleLine];
		// Group steps by level so the operator can see the parallel
		// "lanes" at a glance. A separator line between levels
		// makes the dependency boundary visible.
		let lastLevel: number | undefined;
		for (const step of this.plan.steps) {
			const level = step.level ?? 0;
			if (lastLevel !== undefined && level !== lastLevel) {
				// Dotted separator between DAG levels — a faint
				// visual hint that the dependency graph drops one
				// tier.
				rows.push(colorize("  ·  ".padEnd(width, "·"), "dim"));
			}
			lastLevel = level;
			const { glyph, color } = stepGlyph(step.status);
			const levelBadge = colorize(`Lv${level}`, "dim");
			const line =
				`${colorize(glyph, color)} ${levelBadge}  ${truncateToWidth(step.description, width - 12, "…")}`;
			rows.push(padRight(line, width));
		}
		while (rows.length < 4) rows.push(padRight("", width));
		return box(rows.slice(0, 14), "round", width, "cyan");
	}

	private progressLine(width: number): string {
		const total = this.plan.steps.length || 1;
		const done = this.plan.steps.filter((s) => s.status === "completed").length;
		const bar = renderBar(done, total, Math.max(8, width - 4));
		return colorize(bar, "dim");
	}
}

function renderBar(done: number, total: number, width: number): string {
	const filled = total > 0 ? Math.round((done / total) * width) : 0;
	return "█".repeat(filled) + "░".repeat(width - filled) + ` ${done}/${total}`;
}
