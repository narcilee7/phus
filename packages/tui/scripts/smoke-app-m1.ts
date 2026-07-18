// packages/tui/scripts/smoke-app-m1.ts
// M1+M2 verification: bring up the pi-tui-based App with a stub
// agent and assert the frame contains the Header title, StatusBar
// default hint, and the chat viewport's empty-state placeholder.
//
// Run: pnpm --filter @phus/tui exec tsx scripts/smoke-app-m1.ts

import { TUI } from "../src/vendor/pi-tui/index.js";
import { App, type AppDeps } from "../src/App.js";
import { createManagedTerminal } from "../src/runtime/terminal.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";

function stubAgent(): PhusAgent {
	// The methods App.attach calls on the agent are all no-ops for the
	// purpose of this smoke — we only verify rendering, not event flow.
	return {
		subscribeToAgentEvents: () => () => {},
		subscribeToPlanEvents: () => () => {},
		setToolPermissionHandler: () => {},
		replayTape: () => [],
		getTapeTotalEntries: () => 0,
		getSkillCount: () => 0,
		getMessageCount: () => 0,
		getAutonomyGate: () => ({ decide: async () => "auto" as const }),
	} as unknown as PhusAgent;
}

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
	const deps: AppDeps = {
		agent: stubAgent(),
		sessionId: "tui:user",
		modelLabel: "anthropic/claude-sonnet-4-5",
	};
	const app = new App(deps);
	tui.addChild(app);
	app.attach(tui);

	tui.start();
	await new Promise((r) => setTimeout(r, 250));
	tui.stop();
	managed.stop();

	process.stdout.write = originalWrite;
	const frame = captured.join("");
	const expected = ["Phus", "tui:user", "Ctrl+C quit", "type to start"];
	const missing = expected.filter((s) => !frame.includes(s));
	if (missing.length === 0) {
		console.log("OK · M1+M2 frame contains all expected text");
		process.exit(0);
	} else {
		console.log(`FAIL · missing: ${missing.join(", ")}`);
		console.log("--- frame ---");
		console.log(frame);
		process.exit(1);
	}
}

void main();
