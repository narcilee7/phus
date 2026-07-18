// src/tui/components/base/SpinnerView.ts
// Thin presentational wrapper that adds an "X · <label>" caption to a
// Spinner. The App owns the Spinner instance and starts/stops it.

import type { Component } from "@/vendor/pi-tui/tui.js";
import type { Spinner } from "@/runtime/spinner.js";

export class SpinnerView implements Component {
	constructor(
		private readonly spinner: Spinner,
		private readonly label: string = "",
	) {}

	invalidate(): void {
		this.spinner.invalidate();
	}

	render(width: number): string[] {
		const glyphLines = this.spinner.render(width);
		const glyph = (glyphLines[0] ?? "").trimEnd();
		if (!this.label) return [glyph];
		return [`${glyph} ${this.label}`];
	}
}
