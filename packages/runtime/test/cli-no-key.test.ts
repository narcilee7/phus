// test/cli-no-key.test.ts
// Verify the CLI stays usable when no API key is configured.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildProgram, registerPluginCliCommands } from "../src/cli/program";
import { resetConfigCache } from "../src/infra/config/index";

describe("CLI without API key", () => {
  let tmpDir: string;
  let originalPhusHome: string | undefined;
  let originalKeys: Record<string, string | undefined>;

  beforeEach(async () => {
    originalPhusHome = process.env.PHUS_HOME;
    originalKeys = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
    };
    for (const key of Object.keys(originalKeys)) {
      delete process.env[key];
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-no-key-"));
    process.env.PHUS_HOME = tmpDir;

    // Make sure no stale config is present.
    resetConfigCache();
  });

  afterEach(() => {
    if (originalPhusHome === undefined) {
      delete process.env.PHUS_HOME;
    } else {
      process.env.PHUS_HOME = originalPhusHome;
    }
    for (const [key, value] of Object.entries(originalKeys)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    vi.restoreAllMocks();
  });

  it("program builds and plugin CLI commands register without an API key", async () => {
    const program = buildProgram();
    await expect(
      registerPluginCliCommands(program, {
        paths: { home: tmpDir, tapeDb: "", skillsDir: "", memoryFile: "" },
        providers: { profiles: {}, defaultProfile: "default" },
        profileName: "default",
        log: { file: path.join(tmpDir, "logs", "phus.jsonl"), level: "info" },
        memory: {},
        source: { present: false },
      } as any),
    ).resolves.toBeUndefined();
  });

  it("`phus run` exits 1 and suggests setup when no key is configured", async () => {
    const program = buildProgram();
    await registerPluginCliCommands(program, {
      paths: { home: tmpDir, tapeDb: "", skillsDir: "", memoryFile: "" },
      providers: { profiles: {}, defaultProfile: "default" },
      profileName: "default",
      log: { file: path.join(tmpDir, "logs", "phus.jsonl"), level: "info" },
      memory: {},
      source: { present: false },
    } as any);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);

    await program.parseAsync(["node", "phus", "run", "hello"]);

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(message).toContain("No API key configured");
    expect(message).toContain("phus setup");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("`phus gateway` exits 1 and suggests setup when no key is configured", async () => {
    const program = buildProgram();
    await registerPluginCliCommands(program, {
      paths: { home: tmpDir, tapeDb: "", skillsDir: "", memoryFile: "" },
      providers: { profiles: {}, defaultProfile: "default" },
      profileName: "default",
      log: { file: path.join(tmpDir, "logs", "phus.jsonl"), level: "info" },
      memory: {},
      source: { present: false },
    } as any);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);

    await program.parseAsync(["node", "phus", "gateway", "--websocket", "9999"]);

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(message).toContain("No API key configured");
    expect(message).toContain("phus setup");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
