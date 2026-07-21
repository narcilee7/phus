// src/tui/components/chat/UserMessage.ts

import type { Component } from "../../vendor/pi-tui/tui.js";
import { colorize, wrapTextWithAnsi } from "../../runtime/text-utils.js";

export class UserMessage implements Component {
	constructor(private readonly text: string) {}
	invalidate(): void {}
	render(width: number): string[] {
		const prefix = colorize("❯ ", "bold", "green");
		const inner = wrapTextWithAnsi(colorize(this.text, "bold", "green"), Math.max(1, width - 2));
		return inner.map((line, i) => (i === 0 ? prefix + line : "  " + line));
	}
}
