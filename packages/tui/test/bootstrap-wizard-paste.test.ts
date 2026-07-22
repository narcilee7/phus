// test/bootstrap-wizard-paste.test.ts
// Regression test: pasting into the BootstrapWizard's apiKey / profile
// steps must REPLACE the pre-filled default rather than append to it.
// Before this fix the envVar-mode apiKey was seeded with
// `defaultEnvVarName(provider)` (e.g. "ANTHROPIC_API_KEY") and the input
// handler did `this.apiKey += pasted`, so a paste of "MY_KEY" became
// "ANTHROPIC_API_KEYMY_KEY" and was written verbatim into phus.config.yaml
// as `apiKeyEnv` — credentials refused to load on the next run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getProviders: () => ["anthropic", "openai"],
	getModels: (provider: string) =>
		provider === "anthropic"
			? [{ id: "claude-sonnet-4-20250514" }]
			: [{ id: "gpt-4o" }],
}));

vi.mock("@phus/runtime/infra/config/index.js", () => ({
	configPath: () => "/tmp/phus-test/phus.config.yaml",
	resetConfigCache: () => {},
	loadConfig: () => ({ source: { present: false } }),
}));

import { BootstrapWizard } from "../src/components/wizard/BootstrapWizard.js";

/** The constructor fires `void this.loadProviders()` which is async.
 *  The mock resolves inside `await import(...)` so we just need a couple
 *  of microtask hops before `wizard.providers` is non-empty. */
async function makeWizard(): Promise<BootstrapWizard> {
	let lastFinish = false;
	const wizard = new BootstrapWizard((success) => {
		lastFinish = success;
	});
	for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
	void lastFinish;
	return wizard;
}

/** Walk the wizard from `welcome` to the `apiKey` step in default envVar
 *  mode (preset = "ANTHROPIC_API_KEY"). */
function advanceToApiKeyEnvVar(wizard: BootstrapWizard): void {
	wizard.handleInput("\r"); // welcome → provider
	wizard.handleInput("\r"); // provider → model (default selection)
	wizard.handleInput("\r"); // model → keyMode (default envVar, preset "ANTHROPIC_API_KEY")
	wizard.handleInput("\r"); // keyMode → apiKey
}

/** Walk the wizard from `welcome` to the `profile` step (preset = "default"). */
function advanceToProfile(wizard: BootstrapWizard): void {
	advanceToApiKeyEnvVar(wizard);
	wizard.handleInput("\r"); // apiKey (with preset "ANTHROPIC_API_KEY") → profile
}

/** Drive the wizard to the `confirm` step and return the rendered YAML preview. */
function renderConfirmPreview(wizard: BootstrapWizard): string {
	wizard.handleInput("\r"); // final step → confirm
	return wizard.render(80).join("\n");
}

describe("BootstrapWizard apiKey paste", () => {
	beforeEach(() => {
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("replaces the preset envVar default when the user pastes a different name", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);

		// Simulate a terminal-emitted bracketed paste of "MY_CUSTOM_VAR".
		wizard.handleInput("\x1b[200~MY_CUSTOM_VAR\x1b[201~");

		// Drive to confirm so the wizard composes the final YAML preview.
		wizard.handleInput("\r"); // apiKey → profile
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: MY_CUSTOM_VAR");
		expect(preview).not.toContain("ANTHROPIC_API_KEYMY_CUSTOM_VAR");
	});

	it("replaces the preset envVar default when the user types the first character", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);

		// Type "MY_KE" one char at a time. Without the fix, "M" would
		// land at the tail of "ANTHROPIC_API_KEY" producing
		// "ANTHROPIC_API_KEYM" and the confirm preview would show
		// "apiKeyEnv: ANTHROPIC_API_KEYM…".
		for (const ch of "MY_KE") wizard.handleInput(ch);

		wizard.handleInput("\r"); // apiKey → profile
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: MY_KE");
		expect(preview).not.toContain("ANTHROPIC_API_KEYM");
	});

	it("treats subsequent pastes as append, not replace", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);

		wizard.handleInput("\x1b[200~FIRST\x1b[201~"); // replaces preset
		wizard.handleInput("\x1b[200~_SECOND\x1b[201~"); // appends

		wizard.handleInput("\r"); // apiKey → profile
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: FIRST_SECOND");
	});

	it("treats subsequent typed chars as append", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);

		wizard.handleInput("A");
		wizard.handleInput("B");
		wizard.handleInput("C");

		wizard.handleInput("\r"); // apiKey → profile
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: ABC");
	});

	it("does not reset a confirmed default when the user just presses Enter", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);
		wizard.handleInput("\r"); // apiKey → profile (no edits, keep default)
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: ANTHROPIC_API_KEY");
	});

	it("backspace on the preset counts as a user edit (next input appends)", async () => {
		const wizard = await makeWizard();
		advanceToApiKeyEnvVar(wizard);

		// preset is "ANTHROPIC_API_KEY" (17 chars). Backspace 17 times.
		for (let i = 0; i < 17; i++) wizard.handleInput("\x7f");
		// Now apiKey should be empty.
		wizard.handleInput("Z");

		wizard.handleInput("\r"); // apiKey → profile
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("apiKeyEnv: Z");
		expect(preview).not.toContain("apiKeyEnv: ANTHROPIC_API_KEYZ");
	});
});

describe("BootstrapWizard profile name paste", () => {
	beforeEach(() => {
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("replaces the 'default' preset when the user pastes a custom name", async () => {
		const wizard = await makeWizard();
		advanceToProfile(wizard);

		wizard.handleInput("\x1b[200~production\x1b[201~");
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("defaultProfile: production");
		expect(preview).not.toContain("defaultproduction");
	});

	it("replaces the 'default' preset when the user types the first character", async () => {
		const wizard = await makeWizard();
		advanceToProfile(wizard);

		for (const ch of "pro") wizard.handleInput(ch);
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("defaultProfile: pro");
	});

	it("treats subsequent typed chars as append", async () => {
		const wizard = await makeWizard();
		advanceToProfile(wizard);

		wizard.handleInput("a");
		wizard.handleInput("b");
		wizard.handleInput("c");
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("defaultProfile: abc");
	});

	it("does not reset a confirmed default when the user just presses Enter", async () => {
		const wizard = await makeWizard();
		advanceToProfile(wizard);
		const preview = renderConfirmPreview(wizard);

		expect(preview).toContain("defaultProfile: default");
	});
});