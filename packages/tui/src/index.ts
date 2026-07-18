// src/tui/index.ts
// `phus tui` — launch the interactive TUI. If the config or API key
// is missing, runs the Bootstrap / Key wizard in a transient pi-tui
// session first; once the wizard resolves, the main App takes over.

import { TUI } from "@/vendor/pi-tui/tui.js";
import { App } from "@/App.js";
import { BootstrapWizard } from "@/components/wizard/BootstrapWizard.js";
import { KeyWizard } from "@/components/wizard/KeyWizard.js";
import { createManagedTerminal } from "@/runtime/terminal.js";
import { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { logger } from "@phus/runtime/infra/logging.js";
import { pathToFileURL } from "node:url";
import {
	loadConfig,
	resetConfigCache,
	configPath,
} from "@phus/runtime/infra/config/index.js";
import { resolveProfile, apiKeyForProfile } from "@phus/runtime/infra/profile.js";

function profileHasKey(): boolean {
	try {
		const config = loadConfig();
		const profile = resolveProfile(config.profileName, config.providers);
		return !!apiKeyForProfile(profile);
	} catch {
		return false;
	}
}

/**
 * Run a wizard Component in a transient TUI session. Returns when
 * `onDone` fires (or after `timeoutMs` as a safety net). Restores the
 * terminal between the wizard and the next phase.
 */
async function runWizard(
	factory: (onDone: (success: boolean) => void) => import("@/vendor/pi-tui/tui.js").Component,
	timeoutMs = 60_000,
): Promise<boolean> {
	const managed = createManagedTerminal();
	managed.start();
	const tui = new TUI(managed.terminal);
	let resolveDone: ((v: boolean) => void) | undefined;
	const done = new Promise<boolean>((r) => {
		resolveDone = r;
	});
	const wizard = factory((success) => resolveDone?.(success));
	tui.addChild(wizard);
	tui.setFocus(wizard);
	tui.start();
	const safetyTimer = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
	const result = await Promise.race([done, safetyTimer]);
	tui.stop();
	managed.stop();
	return result;
}

export async function startTui(): Promise<void> {
	let config = loadConfig();

	if (!config.source.present) {
		const ok = await runWizard((onDone) => new BootstrapWizard(onDone));
		if (!ok) {
			// eslint-disable-next-line no-console
			console.log(`[phus] bootstrap cancelled; create ${configPath()} manually to use the TUI.`);
			return;
		}
		resetConfigCache();
		config = loadConfig();
	}

	if (!profileHasKey()) {
		const ok = await runWizard((onDone) => new KeyWizard(onDone));
		if (!ok) {
			const profile = resolveProfile(config.profileName, config.providers);
			const envVar = profile.apiKeyEnv
				? profile.apiKeyEnv
				: `${profile.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
			// eslint-disable-next-line no-console
			console.log("[phus] no API key configured.");
			// eslint-disable-next-line no-console
			console.log(`       Add apiKey to ${configPath()} or set:`);
			// eslint-disable-next-line no-console
			console.log(`         export ${envVar}=<your-key>`);
			return;
		}
		resetConfigCache();
		config = loadConfig();
		if (!profileHasKey()) {
			// eslint-disable-next-line no-console
			console.log("[phus] key still missing; aborting.");
			return;
		}
	}

	const handle = await PhusAgent.create({ config });
	const agent = handle.internals;
	const sessionId = "tui:user";
	const model = agent.getCurrentModel();
	const modelLabel = `${model.provider}/${model.id}`;

	const managed = createManagedTerminal();
	managed.start();
	const tui = new TUI(managed.terminal);

	// Resolved by an OS signal OR by the in-app quit path (/quit, /exit,
	// idle Ctrl+C → App.onQuit). Promise resolution is idempotent.
	let resolveMain!: () => void;
	const mainDone = new Promise<void>((resolve) => {
		resolveMain = resolve;
	});
	const app = new App({
		agent,
		sessionId,
		modelLabel,
		onQuit: () => resolveMain(),
	});
	tui.addChild(app);
	app.attach(tui);

	const onSignal = () => resolveMain();
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);

	logger.info("tui.started", { sessionId, model: modelLabel });
	tui.start();
	await mainDone;
	// detach BEFORE stopping the terminal: it clears the stats interval
	// and unsubscribes listeners — leftover timers would keep the event
	// loop alive and the process would never exit after /quit.
	app.detach();
	tui.stop();
	managed.stop();
	await handle.dispose();
	logger.info("tui.exited", { sessionId });
	// eslint-disable-next-line no-console
	console.log("⛰  Sisyphus rests — the stone stays put.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
	startTui().catch((err) => {
		// eslint-disable-next-line no-console
		console.error("[phus] fatal:", err);
		process.exit(1);
	});
}
