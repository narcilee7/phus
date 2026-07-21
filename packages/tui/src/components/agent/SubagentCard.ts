// src/tui/components/agent/SubagentCard.ts
// Subagent progress card. M2: display-only. M3 adds focus + Enter to
// open the session.

import type { Component } from "../../vendor/pi-tui/tui.js";
import type { PlanSubagentState } from "../../state/state.js";
import { colorize, truncateToWidth } from "../../runtime/text-utils.js";

export class SubagentCard implements Component {
	constructor(private readonly subagent: PlanSubagentState) {}

	invalidate(): void {}

	render(width: number): string[] {
		const status = this.subagent.status;
		const statusColor = status === "running" ? "cyan" : status === "completed" ? "green" : "red";
		const statusGlyph = status === "running" ? "▸" : status === "completed" ? "✓" : "✗";
		const header = `${colorize(statusGlyph, statusColor)} ${colorize(this.subagent.label, statusColor, "bold")} · ${truncateToWidth(this.subagent.goal, width - 8, "…")}`;
		if (!this.subagent.progress) return [header];
		return [header, colorize("  " + truncateToWidth(this.subagent.progress, width - 2, "…"), "dim")];
	}
}
