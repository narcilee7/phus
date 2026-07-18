// packages/tui/scripts/smoke-app-m2.ts
// M2 verification: render a synthetic chat stream through the
// AppStore and assert the viewport surfaces user / assistant /
// tool_call / tool_result rows. Uses a stub agent so we don't need
// a real LLM.
//
// Run: pnpm --filter @phus/tui exec tsx scripts/smoke-app-m2.ts

import { TUI } from "../src/vendor/pi-tui/index.js";
import { App, type AppDeps } from "../src/App.js";
import { createManagedTerminal } from "../src/runtime/terminal.js";
import { eventToAction } from "../src/transform/events.js";
import { planEventToAction } from "../src/transform/plan-events.js";
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

	const store = app.getStore();
	store.dispatch({ type: "add_user", text: "hello phus" });
	store.dispatch(
		eventToAction({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "hi there" },
		} as never)!,
	);
	store.dispatch({ type: "finalize_streaming" });
	store.dispatch(
		eventToAction({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: " — let me check something" },
		} as never)!,
	);
	store.dispatch({ type: "finalize_streaming" });
	store.dispatch({
		type: "upsert_tool_call",
		toolCallId: "tc-1",
		toolName: "bash",
		args: { cmd: "ls" },
	});
	store.dispatch({
		type: "complete_tool_call",
		toolCallId: "tc-1",
		result: { stdout: "a.txt\nb.txt" },
		isError: false,
	});
	store.dispatch(
		planEventToAction(
			{
				type: "plan_step_started",
				planId: "p1",
				sessionId: "tui:user",
				goal: "explore repo",
				step: { id: "s1", description: "explore repo" },
				planStatus: "running",
			} as never,
			{ current: undefined },
		)!,
	);

	tui.start();
	await new Promise((r) => setTimeout(r, 250));
	tui.stop();
	managed.stop();

	process.stdout.write = originalWrite;
	const frame = captured.join("");
	const expected = ["hello phus", "hi there", "bash", "explore repo", "a.txt"];
	const missing = expected.filter((s) => !frame.includes(s));
	if (missing.length === 0) {
		console.log("OK · M2 frame contains user/assistant/tool/plan rows");
		process.exit(0);
	} else {
		console.log(`FAIL · missing: ${missing.join(", ")}`);
		console.log("--- frame (last 800 chars) ---");
		console.log(frame.slice(-800));
		process.exit(1);
	}
}

void main();
