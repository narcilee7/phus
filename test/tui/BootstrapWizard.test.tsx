// test/tui/BootstrapWizard.test.tsx
// First-run bootstrap wizard writes a phus.config.yaml from TUI choices.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { existsSync } from "node:fs";
import { BootstrapWizard } from "../../src/tui/components/boot-strap-components/BootstrapWizard.js";

const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));

const written = {
  path: "",
  content: "",
};

vi.mock("@mariozechner/pi-ai", () => ({
  getProviders: () => ["anthropic", "openai"],
  getModels: (provider: string) =>
    provider === "anthropic"
      ? [{ id: "claude-sonnet-4-20250514" }, { id: "claude-opus-4-20250514" }]
      : [{ id: "gpt-4o" }],
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (path: string, content: string) => {
    written.path = path;
    written.content = content;
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock("../../src/infra/config/index.js", () => ({
  configPath: () => "/tmp/.phus/phus.config.yaml",
  resetConfigCache: vi.fn(),
  loadConfig: vi.fn(() => ({ source: { present: true } })),
}));

describe("BootstrapWizard", () => {
  it("writes config after provider/model/apiKey/profile flow", async () => {
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(<BootstrapWizard onDone={onDone} />);
    await wait(300);

    // Welcome → provider
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("Pick a provider");

    // Provider → model (anthropic selected by default)
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("claude-sonnet");

    // Model → keyMode (default envVar)
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("How do you want to provide the key?");

    // Toggle to inline (down arrow)
    stdin.write("[B");
    await wait(50);
    stdin.write("\r"); // keyMode → apiKey
    await wait(100);
    expect(lastFrame()).toContain("API key");

    // Type api key (secure mode should display bullets, not the actual chars)
    stdin.write("sk-ant-api03-test");
    await wait(50);
    const frame = lastFrame()!;
    expect(frame).not.toContain("sk-ant-api03-test");
    expect(frame).toMatch(/•{10,}/);
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("Profile name");

    // Confirm default profile name
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("Write this config?");

    // Confirm write
    stdin.write("y");
    await wait(200);

    expect(written.path).toBe("/tmp/.phus/phus.config.yaml");
    expect(written.content).toContain("apiKey: sk-ant-api03-test");
    expect(written.content).toContain("claude-sonnet-4-20250514");
  });

  it("uses apiKeyEnv when env var mode is selected", async () => {
    written.path = "";
    written.content = "";
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(<BootstrapWizard onDone={onDone} />);
    await wait(300);

    stdin.write("\r"); // welcome → provider
    await wait(100);
    stdin.write("\r"); // provider → model
    await wait(100);
    stdin.write("\r"); // model → keyMode (envVar is default)
    await wait(100);
    expect(lastFrame()).toContain("environment variable");

    stdin.write("\r"); // keyMode → apiKey (env var name input, prefilled with default)
    await wait(100);
    expect(lastFrame()).toContain("ANTHROPIC_API_KEY");

    stdin.write("\r"); // apiKey → profile (accept default env var name)
    await wait(100);
    stdin.write("\r"); // profile → confirm
    await wait(100);
    stdin.write("y");
    await wait(200);

    expect(written.content).toContain("apiKeyEnv: ANTHROPIC_API_KEY");
    expect(written.content).not.toContain("apiKey:");
  });

  it("calls onDone(false) when user quits from welcome", async () => {
    const onDone = vi.fn();
    const { stdin } = render(<BootstrapWizard onDone={onDone} />);
    await wait(300);
    stdin.write("\x03");
    await wait(100);
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it("refuses to overwrite an existing config file", async () => {
    written.path = "";
    written.content = "";
    vi.mocked(existsSync).mockReturnValue(true);
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(<BootstrapWizard onDone={onDone} />);
    await wait(300);

    stdin.write("\r"); // welcome → provider
    await wait(100);
    stdin.write("\r"); // provider → model
    await wait(100);
    stdin.write("\r"); // model → keyMode
    await wait(100);
    stdin.write("[B"); // toggle to inline
    await wait(50);
    stdin.write("\r"); // keyMode → apiKey
    await wait(100);
    stdin.write("sk-ant-api03-test");
    await wait(50);
    stdin.write("\r"); // apiKey → profile
    await wait(100);
    stdin.write("\r"); // profile → confirm
    await wait(100);
    stdin.write("y"); // confirm write
    await wait(200);

    expect(lastFrame()).toContain("config already exists");
    expect(written.path).toBe("");

    vi.mocked(existsSync).mockReturnValue(false);
  });
});
