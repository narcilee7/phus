// src/tui/components/chat/ToolPill.ts

import type { Component } from "../../vendor/pi-tui/tui.js";
import { colorize, padRight } from "../../runtime/text-utils.js";

export type ToolStatus = "running" | "success" | "error";

function statusGlyph(s: ToolStatus): string {
	return s === "running" ? "▸" : s === "success" ? "✓" : "✗";
}
function statusColor(s: ToolStatus): string {
	return s === "running" ? "cyan" : s === "success" ? "green" : "red";
}

export class ToolPill implements Component {
	constructor(
		private readonly name: string,
		private readonly status: ToolStatus,
		private readonly durationMs?: number,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const glyph = colorize(statusGlyph(this.status), statusColor(this.status));
		const nameStr = colorize(this.name, statusColor(this.status), "bold");
		const dur =
			this.status === "running" || this.durationMs == null
				? ""
				: colorize(this.formatDuration(this.durationMs), "dim");
		return [padRight(`${glyph} ${nameStr}  ${dur}`.trimEnd(), width)];
	}

	private formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const s = ms / 1000;
		if (s < 60) return `${s.toFixed(1)}s`;
		const m = Math.floor(s / 60);
		return `${m}m ${Math.round(s - m * 60)}s`;
	}
}
