// test/tui/BootstrapWizard.test.tsx
// First-run bootstrap wizard writes a phus.config.yaml from TUI choices.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
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
    expect(lastFrame()).toContain("API key environment variable");

    // Type api key env var and confirm
    stdin.write("ANTHROPIC_API_KEY");
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
    expect(written.content).toContain("ANTHROPIC_API_KEY");
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
});
