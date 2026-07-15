// test/litellm-config.test.ts
// Validates the LiteLLM config YAML is well-formed and covers our expected providers.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "yaml";

describe("LiteLLM config", () => {
  const cfgPath = path.resolve(__dirname, "../deploy/litellm-config.yaml");

  it("file exists", () => {
    expect(fs.existsSync(cfgPath)).toBe(true);
  });

  it("parses as valid YAML", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = yaml.parse(raw);
    expect(parsed).toBeDefined();
  });

  it("declares model_list with required providers", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = yaml.parse(raw) as any;
    const modelNames = (parsed.model_list ?? []).map((m: any) => m.model_name);
    expect(modelNames).toContain("openai/gpt-4o");
    expect(modelNames).toContain("anthropic/claude-sonnet-4-20250514");
    expect(modelNames).toContain("openai/deepseek-v3-250324"); // Volcano Ark
  });

  it("declares fallback chains", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = yaml.parse(raw) as any;
    expect(Array.isArray(parsed.fallbacks)).toBe(true);
    expect(parsed.fallbacks.length).toBeGreaterThanOrEqual(2);
    // Each fallback chain is a list of model names
    for (const chain of parsed.fallbacks) {
      expect(Array.isArray(chain)).toBe(true);
      expect(chain.length).toBeGreaterThan(1);
    }
  });

  it("uses env var references for secrets (no hardcoded keys)", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    // Look for any hardcoded sk- prefix
    expect(raw).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    // Should use os.environ/ pattern
    expect(raw).toMatch(/os\.environ\//);
  });

  it("declares router settings", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = yaml.parse(raw) as any;
    expect(parsed.router_settings).toBeDefined();
    expect(parsed.router_settings.routing_strategy).toBeDefined();
    expect(parsed.router_settings.num_retries).toBeGreaterThan(0);
  });

  it("uses master_key from env (not hardcoded)", () => {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const parsed = yaml.parse(raw) as any;
    expect(parsed.general_settings.master_key).toMatch(/os\.environ/);
  });
});
