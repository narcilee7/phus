// src/tui/components/base/StatusBar.ts
// Bottom status line: model, skills, tape entries, shortcut hints.

import type { Component } from "../../vendor/pi-tui/tui.js";
import { colorize, padRight } from "../../runtime/text-utils.js";

const DEFAULT_HINT = "Ctrl+C quit · Ctrl+L clear · PgUp/PgDn scroll";

export class StatusBar implements Component {
	constructor(
		private readonly modelLabel: string,
		private readonly skills: number,
		private readonly entries: number,
		private readonly hint?: string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const line = colorize(
			`${this.modelLabel} · ${this.skills} skills · ${this.entries} tape entries · ${
				this.hint ?? DEFAULT_HINT
			}`,
			"dim",
		);
		return [padRight(line, width)];
	}
}
