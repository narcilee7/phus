// test/setup-wizard.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "yaml";
import { runSetupWizard, type WizardDeps } from "../src/infra/bootstrap/wizard.js";

vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));

import * as readline from "node:readline";

function mockReadline(inputs: string[]) {
  const queue = [...inputs];
  (readline.createInterface as any).mockReturnValue({
    question: (prompt: string, cb: (answer: string) => void) => {
      const answer = queue.shift() ?? "";
      cb(answer);
    },
    close: vi.fn(),
  });
}

vi.mock("@mariozechner/pi-ai", () => ({
  getProviders: () => ["anthropic", "openai"],
  getModels: (provider: string) =>
    provider === "anthropic"
      ? [{ id: "claude-sonnet-4-20250514" }]
      : [{ id: "gpt-4o" }],
}));

describe("runSetupWizard", () => {
  let tmpDir: string;
  let deps: WizardDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-wizard-"));
    deps = {
      config: {
        paths: { home: tmpDir, tapeDb: "", skillsDir: "", memoryFile: "" },
      } as WizardDeps["config"],
      writeConfig: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes phus.config.yaml with provider and model", async () => {
    mockReadline([
      "1", // provider: anthropic
      "1", // model
      "ANTHROPIC_API_KEY", // api key env
      "default", // profile name
      "n", "n", "n", "n", "n", "n", // no channels
    ]);

    await runSetupWizard(deps);

    const cfgPath = path.join(tmpDir, "phus.config.yaml");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = yaml.parse(fs.readFileSync(cfgPath, "utf-8"));
    expect(parsed.providers.defaultProfile).toBe("default");
    expect(parsed.providers.profiles.default.provider).toBe("anthropic");
    expect(parsed.providers.profiles.default.modelId).toBe("claude-sonnet-4-20250514");
    expect(parsed.providers.profiles.default.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("adds channel configuration when enabled", async () => {
    mockReadline([
      "2", // provider: openai
      "1", // model
      "OPENAI_API_KEY",
      "default",
      "y", // telegram
      "tg-token",
      "y", // slack
      "xoxb-bot",
      "xapp-app",
      "n", // email
      "n", // whatsapp
      "y", // websocket
      "y", // sse
    ]);

    await runSetupWizard(deps);

    const cfgPath = path.join(tmpDir, "phus.config.yaml");
    const parsed = yaml.parse(fs.readFileSync(cfgPath, "utf-8"));
    const channels = parsed.channels as Array<{ type: string }>;
    expect(channels.map((c) => c.type)).toEqual(["telegram", "slack", "websocket", "sse"]);
    expect(channels.find((c) => c.type === "telegram")?.token).toBe("tg-token");
  });
});
