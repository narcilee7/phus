// packages/tui/scripts/smoke-app-m4.ts
// M4 verification: the App mounts a real pi-tui Editor, accepts
// typed text, fires onSubmit when Enter is pressed, and routes the
// submitted text into the slash-command handler.
//
// Run: pnpm --filter @phus/tui exec tsx scripts/smoke-app-m4.ts

import { TUI } from "../src/vendor/pi-tui/index.js";
import { App, type AppDeps } from "../src/App.js";
import { createManagedTerminal } from "../src/runtime/terminal.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";

function stubAgent(): PhusAgent {
	return {
		subscribeToAgentEvents: () => () => {},
		subscribeToPlanEvents: () => () => {},
		setToolPermissionHandler: () => {},
		replayTape: () => [],
		getTapeTotalEntries: () => 0,
		getSkillCount: () => 0,
		getMessageCount: () => 0,
		getAutonomyGate: () => ({ decide: async () => "auto" as const }),
		abort: () => {},
		getDiagnostics: () => ({}),
		getMessageCount: () => 0,
		getSessionCount: () => 0,
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
	await new Promise((r) => setTimeout(r, 150));

	// Type "hi" then Enter — should land as a user message in state.items.
	tui.handleInput("h");
	tui.handleInput("i");
	tui.handleInput("\r");
	await new Promise((r) => setTimeout(r, 150));

	const state = app.getStore().getState();
	const lastUser = [...state.items].reverse().find((it) => it.kind === "user");
	const userText = lastUser?.text;

	tui.stop();
	managed.stop();
	process.stdout.write = originalWrite;

	if (userText === "hi") {
		console.log("OK · editor → submit pipeline works (user msg = 'hi')");
		process.exit(0);
	}
	console.log(`FAIL · expected user msg 'hi', got: ${JSON.stringify(userText)}`);
	console.log("state.items:", state.items.map((i) => ({ kind: i.kind, text: i.text })));
	process.exit(1);
}

void main();
