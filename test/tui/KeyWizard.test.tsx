// test/tui/KeyWizard.test.tsx
// Mini-wizard used when phus.config.yaml exists but the active profile
// is missing an API key.

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { KeyWizard } from "../../src/tui/components/KeyWizard.js";

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const written = { path: "", content: "" };

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () =>
    "providers:\n  defaultProfile: default\n  profiles:\n    default:\n      provider: anthropic\n      modelId: claude-sonnet-4-20250514\n",
  ),
  writeFile: vi.fn(async (path: string, content: string) => {
    written.path = path;
    written.content = content;
  }),
}));

vi.mock("../../src/infra/config/index.js", () => ({
  configPath: () => "/tmp/.phus/phus.config.yaml",
  resetConfigCache: vi.fn(),
  loadConfig: vi.fn(() => ({
    profileName: "default",
    providers: {
      defaultProfile: "default",
      profiles: {
        default: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      },
    },
  })),
}));

describe("KeyWizard", () => {
  it("prefills the env var name from the active profile", async () => {
    const { lastFrame } = render(<KeyWizard onDone={vi.fn()} />);
    await wait(80);
    expect(lastFrame()).toContain("Add an API key");
    expect(lastFrame()).toContain("environment variable");
  });

  it("writes apiKeyEnv when envVar mode is confirmed", async () => {
    written.path = "";
    written.content = "";
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(<KeyWizard onDone={onDone} />);
    await wait(80);

    stdin.write("\r"); // mode → value
    await wait(80);
    expect(lastFrame()).toContain("Env var name");

    stdin.write("\r"); // accept default value → save
    await wait(150);

    expect(written.path).toBe("/tmp/.phus/phus.config.yaml");
    expect(written.content).toContain("apiKeyEnv: ANTHROPIC_API_KEY");
    expect(written.content).not.toContain("apiKey:");
    expect(lastFrame()).toContain("Saved");
  });

  it("switches to inline mode and masks the key entry", async () => {
    written.path = "";
    written.content = "";
    const { stdin, lastFrame } = render(<KeyWizard onDone={vi.fn()} />);
    await wait(80);

    stdin.write("[B"); // toggle to inline
    await wait(40);
    stdin.write("\r"); // mode → value
    await wait(40);
    stdin.write("sk-secret-test");
    await wait(40);
    const frame = lastFrame()!;
    expect(frame).not.toContain("sk-secret-test");
    expect(frame).toMatch(/•{5,}/);
    stdin.write("\r");
    await wait(120);
    expect(written.content).toContain("apiKey: sk-secret-test");
  });
});
