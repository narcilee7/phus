// src/tui/components/wizard/BootstrapWizard.ts
// First-run configuration wizard as a pi-tui Component. Walks the
// user through picking a provider, model, API-key mode, and profile
// name, then writes phus.config.yaml and calls onDone.
//
// Lives standalone — the entry point mounts it as the only child of
// a transient TUI, then replaces it with the main App once onDone
// resolves.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import type { Component, Focusable } from "../../vendor/pi-tui/tui.js";
import { matchesKey, Key } from "../../vendor/pi-tui/keys.js";
import { box } from "../../runtime/border.js";
import { colorize, padRight, wrapTextWithAnsi, extractPasteContent } from "../../runtime/text-utils.js";
import { configPath, resetConfigCache } from "@phus/runtime/infra/config/index.js";

type Step = "welcome" | "provider" | "model" | "keyMode" | "apiKey" | "profile" | "confirm" | "done" | "error";

const PICKER_VISIBLE = 10;

function defaultEnvVarName(provider: string | undefined): string {
	if (!provider) return "API_KEY";
	return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export class BootstrapWizard implements Component, Focusable {
	focused = false;
	private step: Step = "welcome";
	private providers: string[] = [];
	private modelsByProvider = new Map<string, string[]>();
	private providerIndex = 0;
	private modelIndex = 0;
	private apiKey = "";
	private keyMode: "envVar" | "inline" = "envVar";
	private profileName = "default";
	private errorMsg: string | undefined;
	private done = false;

	constructor(
		private readonly onDone: (success: boolean) => void,
		private readonly getColumns: () => number = () => 80,
	) {
		void this.loadProviders();
	}

	focus(): void {
		this.focused = true;
	}
	blur(): void {
		this.focused = false;
	}
	invalidate(): void {}

	private async loadProviders(): Promise<void> {
		try {
			const { getProviders, getModels } = await import("@mariozechner/pi-ai");
			const list = getProviders() as string[];
			const map = new Map<string, string[]>();
			for (const p of list) {
				map.set(p, getModels(p as unknown as Parameters<typeof getModels>[0]).map((m) => m.id));
			}
			this.providers = list;
			this.modelsByProvider = map;
		} catch (err) {
			this.errorMsg = `could not load provider registry: ${(err as Error).message ?? err}`;
			this.step = "error";
		}
	}

	handleInput(data: string): void {
		if (this.step === "welcome") {
			if (matchesKey(data, Key.enter) || data === "\r") this.step = "provider";
			else if (matchesKey(data, Key.escape)) this.finish(false);
			return;
		}
		if (this.step === "provider") {
			if (matchesKey(data, Key.up)) this.providerIndex = Math.max(0, this.providerIndex - 1);
			else if (matchesKey(data, Key.down)) {
				this.providerIndex = Math.min(this.providers.length - 1, this.providerIndex + 1);
			}
			else if (matchesKey(data, Key.enter) || data === "\r") {
				this.apiKey = "";
				this.modelIndex = 0;
				this.step = "model";
			} else if (matchesKey(data, Key.escape)) this.step = "welcome";
			return;
		}
		if (this.step === "model") {
			const models = this.currentModels();
			if (matchesKey(data, Key.up)) this.modelIndex = Math.max(0, this.modelIndex - 1);
			else if (matchesKey(data, Key.down)) {
				this.modelIndex = Math.min(models.length - 1, this.modelIndex + 1);
			}
			else if (matchesKey(data, Key.enter) || data === "\r") {
				this.keyMode = "envVar";
				this.apiKey = defaultEnvVarName(this.currentProvider());
				this.step = "keyMode";
			} else if (matchesKey(data, Key.escape)) this.step = "provider";
			return;
		}
		if (this.step === "keyMode") {
			if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
				this.keyMode = this.keyMode === "envVar" ? "inline" : "envVar";
				this.apiKey = this.keyMode === "envVar" ? defaultEnvVarName(this.currentProvider()) : "";
			} else if (matchesKey(data, Key.enter) || data === "\r") {
				this.step = "apiKey";
			} else if (matchesKey(data, Key.escape)) this.step = "model";
			return;
		}
		if (this.step === "apiKey") {
			if (matchesKey(data, Key.enter) || data === "\r") {
				if (this.apiKey.trim().length > 0) this.step = "profile";
			} else if (matchesKey(data, Key.escape)) this.step = "keyMode";
			else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
				this.apiKey = this.apiKey.slice(0, -1);
			} else if (data.length > 0) {
				const pasted = extractPasteContent(data);
				if (pasted !== null) this.apiKey += pasted;
				else if (!data.startsWith("\x1b")) this.apiKey += data;
			}
			return;
		}
		if (this.step === "profile") {
			if (matchesKey(data, Key.enter) || data === "\r") this.step = "confirm";
			else if (matchesKey(data, Key.escape)) this.step = "keyMode";
			else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
				this.profileName = this.profileName.slice(0, -1);
			} else if (data.length > 0) {
				const pasted = extractPasteContent(data);
				if (pasted !== null) this.profileName += pasted;
				else if (!data.startsWith("\x1b")) this.profileName += data;
			}
			return;
		}
		if (this.step === "confirm") {
			if (data === "y" || data === "Y") void this.writeConfig();
			else if (data === "n" || data === "N" || matchesKey(data, Key.escape)) this.step = "profile";
			return;
		}
		if (this.step === "done" || this.step === "error") {
			this.finish(this.step === "done");
		}
	}

	private currentProvider(): string | undefined {
		return this.providers[this.providerIndex];
	}
	private currentModels(): string[] {
		return this.modelsByProvider.get(this.currentProvider() ?? "") ?? [];
	}

	private finish(success: boolean): void {
		if (this.done) return;
		this.done = true;
		this.onDone(success);
	}

	private async writeConfig(): Promise<void> {
		const cfgPath = configPath();
		if (existsSync(cfgPath)) {
			this.errorMsg = `config already exists at ${cfgPath}; wizard will not overwrite it`;
			this.step = "error";
			return;
		}
		const provider = this.currentProvider();
		const modelId = this.currentModels()[this.modelIndex];
		if (!provider || !modelId) {
			this.errorMsg = "provider or model not selected";
			this.step = "error";
			return;
		}
		const name = this.profileName.trim() || "default";
		const profile: Record<string, unknown> = { provider, modelId, thinkingLevel: "medium" };
		if (this.keyMode === "inline" && this.apiKey.trim()) profile.apiKey = this.apiKey.trim();
		else if (this.keyMode === "envVar" && this.apiKey.trim()) profile.apiKeyEnv = this.apiKey.trim();
		try {
			await mkdir(path.dirname(cfgPath), { recursive: true });
			await writeFile(
				cfgPath,
				yaml.stringify({ providers: { defaultProfile: name, profiles: { [name]: profile } } }),
			);
			resetConfigCache();
			this.step = "done";
		} catch (err) {
			this.errorMsg = `could not write config: ${(err as Error).message ?? err}`;
			this.step = "error";
		}
	}

	render(width: number): string[] {
		const body: string[] = [];
		switch (this.step) {
			case "welcome":
				body.push(
					colorize("Welcome to Phus", "bold", "cyan"),
					`No config file found at ${colorize(configPath(), "yellow")}.`,
					"Let's create one in a few steps.",
					"",
					colorize("Enter continue · Esc quit", "dim"),
				);
				break;
			case "provider":
				body.push(...this.renderPicker("Pick a provider", this.providers, this.providerIndex, width));
				break;
			case "model":
				body.push(
					...this.renderPicker(
						`Pick a model for ${this.currentProvider() ?? ""}`,
						this.currentModels(),
						this.modelIndex,
						width,
					),
				);
				break;
			case "keyMode":
				body.push(
					colorize("How do you want to provide the key?", "bold", "cyan"),
					"",
					colorize(
						(this.keyMode === "envVar" ? "› " : "  ") + "Use an environment variable (recommended)",
						this.keyMode === "envVar" ? "cyan" : "dim",
					),
					colorize(
						(this.keyMode === "inline" ? "› " : "  ") + "Paste the key inline (stored in config)",
						this.keyMode === "inline" ? "cyan" : "dim",
					),
					"",
					colorize("↑↓ toggle · Enter confirm · Esc back", "dim"),
				);
				break;
			case "apiKey": {
				const title = this.keyMode === "envVar" ? "Env var name" : "API key";
				body.push(
					...this.renderTextStep(
						title,
						this.apiKey,
						this.keyMode === "envVar"
							? defaultEnvVarName(this.currentProvider())
							: "sk-...",
						this.keyMode,
						width,
					),
				);
				break;
			}
			case "profile":
				body.push(
					...this.renderTextStep("Profile name", this.profileName, "default", false, width),
				);
				break;
			case "confirm": {
				const name = this.profileName.trim() || "default";
				const preview = yaml.stringify({
					providers: {
						defaultProfile: name,
						profiles: {
							[name]: {
								provider: this.currentProvider(),
								modelId: this.currentModels()[this.modelIndex],
								...(this.keyMode === "inline"
									? { apiKey: this.apiKey.trim() ? "***" : "(missing)" }
									: { apiKeyEnv: this.apiKey.trim() || "(missing)" }),
								thinkingLevel: "medium",
							},
						},
					},
				}).trimEnd();
				body.push(
					colorize("Write this config?", "bold", "cyan"),
					"",
					...wrapTextWithAnsi(preview, width - 4),
					"",
					colorize("y confirm · n edit · Esc back", "dim"),
				);
				break;
			}
			case "done":
				body.push(
					colorize("✓ Config saved", "bold", "green"),
					configPath(),
					"",
					colorize("Enter continue to Phus", "dim"),
				);
				break;
			case "error":
				body.push(
					colorize("Setup failed", "bold", "red"),
					colorize(this.errorMsg ?? "unknown error", "red"),
					"",
					colorize("Enter/Esc exit", "dim"),
				);
				break;
		}
		const lines = box(body, "double", width, "cyan");
		void this.getColumns;
		return lines;
	}

	private renderPicker(title: string, items: string[], selected: number, width: number): string[] {
		if (items.length === 0) {
			return [colorize(title, "bold", "cyan"), colorize("(no items)", "dim")];
		}
		const start = Math.max(0, Math.min(selected, items.length - PICKER_VISIBLE));
		const visible = items.slice(start, start + PICKER_VISIBLE);
		const out: string[] = [colorize(title, "bold", "cyan"), ""];
		for (let i = 0; i < visible.length; i++) {
			const idx = start + i;
			const isSel = idx === selected;
			const prefix = isSel ? colorize("› ", "cyan") : "  ";
			const label = truncate(visible[i] ?? "", Math.max(1, width - 6));
			out.push(padRight((isSel ? colorize(prefix + label, "inverse") : prefix + label), width - 4));
		}
		out.push("");
		out.push(colorize("↑↓ navigate · Enter confirm · Esc back", "dim"));
		return out;
	}

	private renderTextStep(
		title: string,
		value: string,
		placeholder: string,
		secure: boolean | "envVar" | "inline",
		width: number,
	): string[] {
		const display = secure === true && value.length > 0 ? "•".repeat(value.length) : value;
		return [
			colorize(title, "bold", "cyan"),
			"",
			colorize(display || placeholder, value ? "cyan" : "dim") + colorize("▍", "cyan"),
			"",
			colorize(
				secure === "envVar" || secure === "inline"
					? `Phus will read $${value || defaultEnvVarName(this.currentProvider())} from the environment.`
					: "Type the key; it will be stored in phus.config.yaml.",
				"dim",
			),
			colorize("Enter confirm · Esc back", "dim"),
		];
	}
}
