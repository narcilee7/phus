// scripts/smoke-pi-tui.ts
// Smoke test: bring up pi-tui's TUI, render a header + an editor with
// hello-world content, exit cleanly. We write to a pipe so we can both
// capture the frame AND not pollute the test runner's stdout.
//
// Run with: pnpm tsx scripts/smoke-pi-tui.ts

import { TUI, ProcessTerminal, Text, Editor, type EditorTheme } from "../packages/tui/src/vendor/pi-tui/index.js";
import { Writable } from "node:stream";

async function main(): Promise<void> {
	const captured: string[] = [];
	// Capture stdout via a writable that splits writes: process.stdout still
	// gets them (so the operator sees the frame), but we also append to
	// `captured` for assertion. pi-tui calls ProcessTerminal's stdout.write
	// internally — by default that is `process.stdout`, so we wrap it.
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
		captured.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8"));
		// @ts-expect-error — overload forwarding
		return originalWrite(chunk, ...rest);
	}) as typeof process.stdout.write;

	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);
	tui.addChild(new Text("phus · pi-tui smoke test"));
	tui.addChild(new Text(""));

	const theme: EditorTheme = {
		borderColor: (s) => s,
		selectList: {
			selectedPrefix: (s) => s,
			selectedText: (s) => s,
			scrollInfo: (s) => s,
			noMatch: (s) => s,
		},
	};
	const editor = new Editor(tui, theme);
	editor.setText("hello from pi-tui");
	tui.addChild(editor);
	tui.setFocus(editor);

	tui.start();
	await new Promise((r) => setTimeout(r, 150));
	tui.stop();

	process.stdout.write = originalWrite;
	const frame = captured.join("");
	const expected = ["phus · pi-tui smoke test", "hello from pi-tui"];
	const missing = expected.filter((s) => !frame.includes(s));
	if (missing.length === 0) {
		console.log("OK · frame contains all expected text");
		process.exit(0);
	} else {
		console.log(`FAIL · missing: ${missing.join(", ")}`);
		process.exit(1);
	}
}

void main();