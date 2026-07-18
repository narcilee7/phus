// src/tui/components/wizard/KeyWizard.ts
// Lightweight wizard for "config exists but no API key" — let the
// user pick env-var vs inline, write the new value back into the
// active profile, then call onDone.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import type { Component, Focusable } from "@/vendor/pi-tui/tui.js";
import { matchesKey, Key } from "@/vendor/pi-tui/keys.js";
import { box } from "@/runtime/border.js";
import { colorize } from "@/runtime/text-utils.js";
import { configPath, loadConfig, resetConfigCache } from "@phus/runtime/infra/config/index.js";

type Step = "mode" | "value" | "done" | "error";

function defaultEnvVarName(provider: string | undefined): string {
	if (!provider) return "API_KEY";
	return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

export class KeyWizard implements Component, Focusable {
	focused = false;
	private step: Step = "mode";
	private mode: "envVar" | "inline" = "envVar";
	private value = "";
	private errorMsg: string | undefined;
	private provider: string | undefined;
	private done = false;

	constructor(private readonly onDone: (success: boolean) => void) {
		try {
			const cfg = loadConfig();
			const profile = cfg.providers?.profiles?.[cfg.profileName];
			const providerName = profile?.provider;
			this.provider = providerName;
			this.value = defaultEnvVarName(providerName);
		} catch {
			// ignore
		}
	}

	focus(): void {
		this.focused = true;
	}
	blur(): void {
		this.focused = false;
	}
	invalidate(): void {}

	handleInput(data: string): void {
		if (this.step === "mode") {
			if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
				this.mode = this.mode === "envVar" ? "inline" : "envVar";
				this.value = this.mode === "envVar" ? defaultEnvVarName(this.provider) : "";
			} else if (matchesKey(data, Key.enter) || data === "\r") {
				this.step = "value";
			} else if (matchesKey(data, Key.escape)) {
				this.finish(false);
			}
			return;
		}
		if (this.step === "value") {
			if (matchesKey(data, Key.enter) || data === "\r") void this.save();
			else if (matchesKey(data, Key.escape)) this.step = "mode";
			else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
				this.value = this.value.slice(0, -1);
			} else if (data.length > 0 && !data.startsWith("\x1b")) {
				this.value += data;
			}
			return;
		}
		if (this.step === "done" || this.step === "error") this.finish(this.step === "done");
	}

	private finish(success: boolean): void {
		if (this.done) return;
		this.done = true;
		this.onDone(success);
	}

	private async save(): Promise<void> {
		const cfgPath = configPath();
		if (!existsSync(cfgPath)) {
			this.errorMsg = `config not found at ${cfgPath}`;
			this.step = "error";
			return;
		}
		try {
			const raw = await readFile(cfgPath, "utf-8");
			const cfg = yaml.parse(raw) ?? {};
			const profiles = (cfg.providers?.profiles ?? {}) as Record<string, Record<string, unknown>>;
			const activeName = cfg.providers?.defaultProfile ?? "default";
			const profile = profiles[activeName];
			if (!profile) {
				this.errorMsg = `active profile "${activeName}" not found in config`;
				this.step = "error";
				return;
			}
			if (this.mode === "envVar") {
				profile.apiKeyEnv = this.value.trim() || undefined;
				delete profile.apiKey;
			} else {
				profile.apiKey = this.value.trim() || undefined;
				delete profile.apiKeyEnv;
			}
			await mkdir(path.dirname(cfgPath), { recursive: true });
			await writeFile(cfgPath, yaml.stringify(cfg));
			resetConfigCache();
			this.step = "done";
		} catch (err) {
			this.errorMsg = `could not update config: ${(err as Error).message ?? err}`;
			this.step = "error";
		}
	}

	render(width: number): string[] {
		const body: string[] = [
			colorize("Add an API key", "bold", "cyan"),
			"Phus needs an API key to reach the model provider.",
		];
		if (this.step === "mode") {
			body.push(
				"",
				colorize(
					(this.mode === "envVar" ? "› " : "  ") + "Use an environment variable (recommended)",
					this.mode === "envVar" ? "cyan" : "dim",
				),
				colorize(
					(this.mode === "inline" ? "› " : "  ") + "Paste the key inline (stored in config)",
					this.mode === "inline" ? "cyan" : "dim",
				),
				"",
				colorize("↑↓ toggle · Enter confirm · Esc quit", "dim"),
			);
		} else if (this.step === "value") {
			const display = this.mode === "inline" && this.value.length > 0 ? "•".repeat(this.value.length) : this.value;
			body.push(
				"",
				colorize(this.mode === "envVar" ? "Env var name" : "API key", "bold", "cyan"),
				colorize(display || " ", "cyan") + colorize("▍", "cyan"),
				"",
				colorize(
					this.mode === "envVar"
						? `Phus will read $${this.value || "API_KEY"} from the environment.`
						: "Type the key; it will be stored in phus.config.yaml.",
					"dim",
				),
				colorize("Enter confirm · Esc back", "dim"),
			);
		} else if (this.step === "done") {
			body.push("", colorize("✓ Saved", "bold", "green"), colorize("Enter continue to Phus", "dim"));
		} else if (this.step === "error") {
			body.push(
				"",
				colorize("Setup failed", "bold", "red"),
				colorize(this.errorMsg ?? "unknown error", "red"),
				colorize("Enter/Esc exit", "dim"),
			);
		}
		return box(body, "double", width, "cyan");
	}
}
