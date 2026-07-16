// test/profile.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadProviderConfig, resolveProfile, modelFromProfile, formatProfiles, apiKeyForProfile } from "../src/infra/profile.js";

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
    expect(cfg.profiles.default.provider).toBe("anthropic");
    expect(cfg.profiles.default.modelId).toContain("claude");
  });

  it("loads profiles from phus.config.yaml", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  defaultProfile: fast
  profiles:
    fast:
      provider: openai
      modelId: gpt-4o-mini
      description: cheap + fast
    smart:
      provider: anthropic
      modelId: claude-sonnet-4-20250514
      baseUrl: https://api.anthropic.com
      thinkingLevel: high
      description: for hard problems
`,
    );
    const cfg = loadProviderConfig();
    expect(cfg.defaultProfile).toBe("fast");
    expect(cfg.profiles.fast?.provider).toBe("openai");
    expect(cfg.profiles.fast?.modelId).toBe("gpt-4o-mini");
    expect(cfg.profiles.smart?.provider).toBe("anthropic");
    expect(cfg.profiles.smart?.modelId).toBe("claude-sonnet-4-20250514");
    expect(cfg.profiles.smart?.thinkingLevel).toBe("high");
  });

  it("resolveProfile returns the named profile", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    p1:
      provider: openai
      modelId: gpt-4o
    p2:
      provider: anthropic
      modelId: claude-sonnet-4-20250514
`,
    );
    const p = resolveProfile("p2");
    expect(p.provider).toBe("anthropic");
    expect(p.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("resolveProfile falls back to defaultProfile", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  defaultProfile: p1
  profiles:
    p1:
      provider: openai
      modelId: gpt-4o
    p2:
      provider: anthropic
      modelId: claude-sonnet-4-20250514
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
      provider: openai
      modelId: gpt-4o
`,
    );
    expect(() => resolveProfile("nope")).toThrow(/Unknown profile "nope"/);
  });

  it("modelFromProfile applies baseUrl and wireId overrides", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    volcano:
      provider: deepseek
      modelId: deepseek-v3-250324
      baseUrl: https://ark.cn-beijing.volces.com/api/v3
      wireId: ep-custom-id
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
      provider: openai
      modelId: gpt-4o-mini
    smart:
      provider: anthropic
      modelId: claude-sonnet-4-20250514
`,
    );
    const out = formatProfiles();
    expect(out).toContain("★ fast");
    expect(out).toContain("  smart");
    expect(out).toContain("openai/gpt-4o-mini");
  });

  it("apiKeyForProfile prefers inline apiKey over env var", () => {
    const profile = {
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "sk-inline",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    };
    process.env.DEEPSEEK_API_KEY = "sk-env";
    expect(apiKeyForProfile(profile)).toBe("sk-inline");
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("apiKeyForProfile falls back to apiKeyEnv when apiKey is absent", () => {
    const profile = {
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    };
    process.env.DEEPSEEK_API_KEY = "sk-env";
    expect(apiKeyForProfile(profile)).toBe("sk-env");
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("apiKeyForProfile reads inline apiKey from YAML", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `providers:
  profiles:
    default:
      provider: deepseek
      modelId: deepseek-v4-flash
      apiKey: sk-yaml
`,
    );
    const profile = resolveProfile("default");
    expect(apiKeyForProfile(profile)).toBe("sk-yaml");
  });
});