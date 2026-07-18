// src/tui/index.ts
// `phus tui` — launch the interactive TUI.
//
// M1 wiring: we boot the Bootstrap / Key wizards via React/ink
// (unchanged from the pre-migration entry), then hand off to the new
// pi-tui App class for the main TUI. M4 will rewrite the wizards as
// pi-tui Components too and drop the React boot path.

import React from "react";
import { render as inkRender } from "ink";
import { TUI } from "@/vendor/pi-tui/tui.js";
import { App } from "@/App.js";
import { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { logger } from "@phus/runtime/infra/logging.js";
import { loadConfig, resetConfigCache, configPath } from "@phus/runtime/infra/config/index.js";
import { BootstrapWizard } from "@/components/boot-strap-components/BootstrapWizard.js";
import { KeyWizard } from "@/components/boot-strap-components/KeyWizard.js";
import { resolveProfile, apiKeyForProfile } from "@phus/runtime/infra/profile.js";
import { createManagedTerminal } from "@/runtime/terminal.js";

function profileHasKey(): boolean {
	try {
		const config = loadConfig();
		const profile = resolveProfile(config.profileName, config.providers);
		return !!apiKeyForProfile(profile);
	} catch {
		return false;
	}
}

async function runBootstrapWizard(): Promise<boolean> {
	return new Promise((resolve) => {
		const { unmount } = inkRender(
			React.createElement(BootstrapWizard, {
				onDone: (success: boolean) => {
					unmount();
					resolve(success);
				},
			}),
		);
	});
}

async function runKeyWizard(): Promise<boolean> {
	return new Promise((resolve) => {
		const { unmount } = inkRender(
			React.createElement(KeyWizard, {
				onDone: (success: boolean) => {
					unmount();
					resolve(success);
				},
			}),
		);
	});
}

export async function startTui(): Promise<void> {
	let config = loadConfig();

	if (!config.source.present) {
		const configured = await runBootstrapWizard();
		if (!configured) {
			// eslint-disable-next-line no-console
			console.log(`[phus] bootstrap cancelled; create ${configPath()} manually to use the TUI.`);
			return;
		}
		resetConfigCache();
		config = loadConfig();
	}

	if (!profileHasKey()) {
		const configured = await runKeyWizard();
		if (!configured) {
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

	// M1: bring up the pi-tui runtime + new App skeleton.
	const managed = createManagedTerminal();
	managed.start();
	const tui = new TUI(managed.terminal);
	const app = new App({ sessionId, modelLabel });
	tui.addChild(app);
	app.attach(tui);

	const onExit = () => {
		// Defer the stop until the render loop has flushed so the cursor
		// lands below the last content (mirrors TUI.stop's behavior).
		setImmediate(() => {
			tui.stop();
			managed.stop();
		});
	};
	process.once("SIGINT", onExit);
	process.once("SIGTERM", onExit);

	logger.info("tui.started", { sessionId, model: modelLabel });
	tui.start();
	await new Promise<void>((resolve) => {
		// pi-tui's TUI doesn't expose a waitUntilExit like ink does.
		// We resolve on SIGINT/SIGTERM via `onExit` plus a polling
		// fallback once the App requests a quit through the store.
		const onSignal = () => {
			resolve();
		};
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
		// The store's request_quit action will be wired in M3 — until
		// then, the only exit path is SIGINT/SIGTERM.
	});
	managed.stop();
	await handle.dispose();
	logger.info("tui.exited", { sessionId });
}
