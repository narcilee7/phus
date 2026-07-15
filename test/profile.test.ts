// test/profile.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadProviderConfig, resolveProfile, modelFromProfile, formatProfiles } from "../src/core/llm/profile.js";

describe("profile loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-profile-"));
    process.env.PHUS_HOME = dir;
  });

  afterEach(() => {
    delete process.env.PHUS_HOME;
  });

  it("returns default profile when no config exists", () => {
    const cfg = loadProviderConfig();
    expect(cfg.profiles.default).toBeDefined();
    expect(cfg.profiles.default.model).toContain("/");
  });

  it("loads profiles from phus.config.yaml", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  defaultProfile: fast
  profiles:
    fast:
      model: openai/gpt-4o-mini
      description: cheap + fast
    smart:
      model: anthropic/claude-sonnet-4-20250514
      baseUrl: https://api.anthropic.com
      thinkingLevel: high
      description: for hard problems
`,
    );
    const cfg = loadProviderConfig();
    expect(cfg.defaultProfile).toBe("fast");
    expect(cfg.profiles.fast?.model).toBe("openai/gpt-4o-mini");
    expect(cfg.profiles.smart?.thinkingLevel).toBe("high");
  });

  it("resolveProfile returns the named profile", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    p1:
      model: openai/gpt-4o
    p2:
      model: anthropic/claude-sonnet-4-20250514
`,
    );
    const p = resolveProfile("p2");
    expect(p.model).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("resolveProfile falls back to defaultProfile", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  defaultProfile: p1
  profiles:
    p1:
      model: openai/gpt-4o
    p2:
      model: anthropic/claude-sonnet-4-20250514
`,
    );
    const p = resolveProfile();
    expect(p.name).toBe("p1");
  });

  it("throws on unknown profile", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    p1:
      model: openai/gpt-4o
`,
    );
    expect(() => resolveProfile("nope")).toThrow(/Unknown profile "nope"/);
  });

  it("modelFromProfile applies baseUrl and modelId overrides", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    volcano:
      model: deepseek/deepseek-v3-250324
      baseUrl: https://ark.cn-beijing.volces.com/api/v3
      modelId: ep-custom-id
`,
    );
    const model = modelFromProfile(resolveProfile("volcano"));
    expect(model.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(model.id).toBe("ep-custom-id");
  });

  it("formatProfiles lists profiles with default marker", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  defaultProfile: fast
  profiles:
    fast:
      model: openai/gpt-4o-mini
    smart:
      model: anthropic/claude-sonnet-4-20250514
`,
    );
    const out = formatProfiles();
    expect(out).toContain("★ fast");
    expect(out).toContain("  smart");
    expect(out).toContain("openai/gpt-4o-mini");
  });
});
