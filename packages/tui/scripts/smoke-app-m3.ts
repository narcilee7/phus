// packages/tui/scripts/smoke-app-m3.ts
// M3 verification: dispatch a permission request into the store and
// confirm the PermissionPanel mounts, renders its body, and accepts
// the `y` key by resolving the queued request.
//
// Run: pnpm --filter @phus/tui exec tsx scripts/smoke-app-m3.ts

import { TUI } from "../src/vendor/pi-tui/index.js";
import { App, type AppDeps } from "../src/App.js";
import { createManagedTerminal } from "../src/runtime/terminal.js";
import { matchesKey } from "../src/vendor/pi-tui/keys.js";
import type { PhusAgent, PermissionRequest } from "../src/state/state.js";
import type { PhusAgent as PhusAgentReal } from "@phus/runtime/bridge/pi-agent.js";

function stubAgent(): PhusAgentReal {
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
	} as unknown as PhusAgentReal;
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

	// Queue a permission request through the store directly.
	let resolved = false;
	app.getStore().dispatch({
		type: "push_permission",
		request: {
			id: "p1",
			toolName: "bash",
			toolCallId: "tc-1",
			args: { command: "rm -rf /tmp/test" },
			caption: "run rm -rf",
			resolve: () => {
				resolved = true;
			},
		} satisfies { type: "push_permission"; request: PermissionRequest },
	});

	tui.start();
	await new Promise((r) => setTimeout(r, 150));

	const frame = captured.join("");
	const hasPanel = /rm -rf/.test(frame) && /\[Y\]es/.test(frame);
	if (!hasPanel) {
		console.log("FAIL · permission panel not visible in frame");
		console.log(frame.slice(-600));
		tui.stop();
		managed.stop();
		process.stdout.write = originalWrite;
		process.exit(1);
	}

	// Drive the `y` key through TUI so the focused panel consumes it.
	const yKey = "y";
	tui.handleInput(yKey);
	await new Promise((r) => setTimeout(r, 100));
	tui.stop();
	managed.stop();
	process.stdout.write = originalWrite;

	if (resolved) {
		console.log("OK · permission panel rendered and `y` resolved the request");
		process.exit(0);
	} else {
		console.log("FAIL · `y` did not resolve the permission request");
		process.exit(1);
	}

	void matchesKey;
	void tui;
}

void main();
