// packages/tui/scripts/smoke-app-m1.ts
// M1 verification: bring up the new pi-tui-based App and assert the
// frame contains the Header title and StatusBar default hint. We
// don't need a real PhusAgent — App's M1 surface only reads
// sessionId + modelLabel for the title.
//
// Run: pnpm --filter @phus/tui exec tsx scripts/smoke-app-m1.ts

import { TUI } from "../src/vendor/pi-tui/index.js";
import { App } from "../src/App.js";
import { createManagedTerminal } from "../src/runtime/terminal.js";

async function main(): Promise<void> {
	const captured: string[] = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
		captured.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8"));
		// @ts-expect-error — forwarding variadic args.
		return originalWrite(chunk, ...rest);
	}) as typeof process.stdout.write;

	const managed = createManagedTerminal({ altScreen: false, syncOutput: true });
	managed.start();
	const tui = new TUI(managed.terminal);
	const app = new App({ sessionId: "tui:user", modelLabel: "anthropic/claude-sonnet-4-5" });
	tui.addChild(app);
	app.attach(tui);

	tui.start();
	await new Promise((r) => setTimeout(r, 250));
	tui.stop();
	managed.stop();

	process.stdout.write = originalWrite;
	const frame = captured.join("");
	const expected = ["Phus", "tui:user", "Ctrl+C quit", "chat viewport"];
	const missing = expected.filter((s) => !frame.includes(s));
	if (missing.length === 0) {
		console.log("OK · M1 frame contains all expected text");
		process.exit(0);
	} else {
		console.log(`FAIL · missing: ${missing.join(", ")}`);
		console.log("--- frame ---");
		console.log(frame);
		process.exit(1);
	}
}

void main();
