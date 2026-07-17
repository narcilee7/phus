// test/tui/BootstrapWizard.test.tsx
// First-run bootstrap wizard writes a phus.config.yaml from TUI choices.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { existsSync } from "node:fs";
import { BootstrapWizard } from "../../src/tui/components/BootstrapWizard.js";

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

    // Model → apiKey
    stdin.write("\r");
    await wait(100);
    expect(lastFrame()).toContain("API key");

    // Type api key and confirm
    stdin.write("sk-ant-api03-test");
    await wait(50);
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
    stdin.write("\r"); // model → apiKey
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
