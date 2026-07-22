// src/tui/components/base/Header.ts
// Top status bar: model label, session, tape stats, last op.
//
// Port of components/app-common-components/Header.tsx to a pi-tui
// `Component` (no React). The rounded-cyan border that ink gave us is
// reconstructed via runtime/border.ts.

import type { Component } from "../../vendor/pi-tui/tui.js";
import { box } from "../../runtime/border.js";
import { colorize } from "../../runtime/text-utils.js";

export interface HeaderStats {
	entries: number;
	skills: number;
	turns: number;
	checkpoints: number;
	lastCheckpointAt?: number;
}

function formatCheckpointAge(ts: number | undefined): string {
	if (!ts) return "";
	const diff = Date.now() - ts;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export class Header implements Component {
	constructor(
		private readonly model: string,
		private readonly session: string,
		private readonly stats: HeaderStats,
		private readonly lastOp: string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const checkpointHint =
			this.stats.checkpoints > 0
				? ` · ${this.stats.checkpoints} checkpoints${
						this.stats.lastCheckpointAt
							? ` · last ${formatCheckpointAge(this.stats.lastCheckpointAt)}`
							: ""
					}`
				: "";
		const titleLine =
			colorize("⛰  Phus", "bold", "cyan") + "  ·  " + this.model + "  ·  push the stone up the mountain";
		const detailLine = colorize(
			`session=${this.session} · ${this.stats.skills} skills · ${this.stats.entries} tape entries${checkpointHint} · ${this.lastOp}`,
			"dim",
		);
		return box([titleLine, detailLine], "round", width, "cyan");
	}
}
