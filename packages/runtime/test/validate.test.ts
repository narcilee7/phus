// test/validate.test.ts
// Load-time validation + cached model resolution.

import { describe, expect, it, beforeEach } from "vitest";
import {
  resolveAndCache,
  resetModelCache,
  validateModelString,
  validateMeshEntry,
  looksLikeSecret,
  _modelCacheSize,
} from "../src/infra/config/validate";

describe("resolveAndCache", () => {
  beforeEach(() => resetModelCache());

  it("resolves a known Pi (provider, modelId) to a real Model", () => {
    const r = resolveAndCache({ provider: "openai", modelId: "gpt-4o-mini" });
    expect(r.inRegistry).toBe(true);
    expect(r.model.id).toBe("gpt-4o-mini");
    expect(r.model.provider).toBe("openai");
  });

  it("synthesizes a Model for unknown (provider, modelId) without throwing", () => {
    // Custom OpenAI-compatible gateway model — Pi doesn't know about it.
    const r = resolveAndCache({
      provider: "openai",
      modelId: "ep-20241120-abc123",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      overrideId: "ep-20241120-abc123",
    });
    expect(r.inRegistry).toBe(false);
    expect(r.model.id).toBe("ep-20241120-abc123");
    expect(r.model.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    // Synthesized stub still has safe defaults so downstream spread works.
    expect(r.model.contextWindow).toBeGreaterThan(0);
    expect(r.model.cost).toBeDefined();
  });

  it("applies baseUrl + overrideId on top of the registry base", () => {
    const r = resolveAndCache({
      provider: "openai",
      modelId: "gpt-4o-mini",
      baseUrl: "https://gateway.example.com/v1",
      overrideId: "custom-deployment",
    });
    expect(r.model.id).toBe("custom-deployment");
    expect(r.model.baseUrl).toBe("https://gateway.example.com/v1");
    // Preserved from Pi registry
    expect(r.model.contextWindow).toBeGreaterThan(0);
  });

  it("caches by (provider, modelId, baseUrl, overrideId) tuple", () => {
    const a1 = resolveAndCache({ provider: "openai", modelId: "gpt-4o-mini" });
    const a2 = resolveAndCache({ provider: "openai", modelId: "gpt-4o-mini" });
    expect(a1).toBe(a2);
    expect(_modelCacheSize()).toBe(1);

    // Different baseUrl → different cache entry.
    const b = resolveAndCache({
      provider: "openai",
      modelId: "gpt-4o-mini",
      baseUrl: "https://x",
    });
    expect(b).not.toBe(a1);
    expect(_modelCacheSize()).toBe(2);
  });

  it("resetModelCache clears everything (for tests)", () => {
    resolveAndCache({ provider: "openai", modelId: "gpt-4o-mini" });
    expect(_modelCacheSize()).toBe(1);
    resetModelCache();
    expect(_modelCacheSize()).toBe(0);
  });
});

describe("validateModelString", () => {
  it("parses well-formed <provider>/<modelId>", () => {
    expect(validateModelString("anthropic/claude-sonnet-4-20250514")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it("accepts a single-slash modelId with dots/dashes", () => {
    expect(validateModelString("openai/gpt-4o-mini-2024-07-18")).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini-2024-07-18",
    });
  });

  it("rejects empty string", () => {
    const r = validateModelString("");
    expect(typeof r).toBe("string");
    expect(r).toMatch(/empty/);
  });

  it("rejects missing slash", () => {
    const r = validateModelString("claude-sonnet-4");
    expect(typeof r).toBe("string");
    expect(r).toMatch(/<provider>\/<modelId>/);
  });

  it("rejects leading slash", () => {
    const r = validateModelString("/claude-sonnet-4");
    expect(typeof r).toBe("string");
  });

  it("rejects trailing slash", () => {
    const r = validateModelString("anthropic/");
    expect(typeof r).toBe("string");
  });

  it("rejects more than one slash (footgun — modelId in wrong field)", () => {
    const r = validateModelString("anthropic/claude/sonnet-4");
    expect(typeof r).toBe("string");
    expect(r).toMatch(/more than one "\/"/);
  });

  it("rejects non-string values with type info", () => {
    const r = validateModelString(42, { profileName: "smart" });
    expect(typeof r).toBe("string");
    expect(r).toMatch(/must be a string/);
    expect(r).toMatch(/smart/);
  });
});

describe("validateMeshEntry", () => {
  it("parses a valid mesh entry", () => {
    const r = validateMeshEntry(
      { provider: "openai", modelId: "gpt-4o-mini" },
      0,
      { profileName: "smart" },
    );
    expect(r).toEqual({ provider: "openai", modelId: "gpt-4o-mini" });
  });

  it("rejects non-object entry", () => {
    const r = validateMeshEntry("not-an-object", 0);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/object/);
  });

  it("rejects missing provider", () => {
    const r = validateMeshEntry({ modelId: "x" }, 1);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/provider/);
  });

  it("rejects missing modelId", () => {
    const r = validateMeshEntry({ provider: "openai" }, 0);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/modelId/);
  });

  it("includes mesh index + profile name in error message", () => {
    const r = validateMeshEntry({}, 3, { profileName: "fast" });
    expect(typeof r).toBe("string");
    expect(r).toMatch(/mesh\[3\]/);
    expect(r).toMatch(/fast/);
  });
});

describe("looksLikeSecret", () => {
  it("detects OpenAI / Anthropic-style prefixes", () => {
    expect(looksLikeSecret("sk-proj-abc123def456ghi789")).toMatch(/sk-/);
    expect(looksLikeSecret("sk-ant-api03-abcdef123456")).toMatch(/sk-ant-/);
    expect(looksLikeSecret("sk-or-v1-abc123")).toMatch(/sk-or-/);
  });

  it("detects Groq / xAI / Google / HF prefixes", () => {
    expect(looksLikeSecret("gsk_abc123def456ghi789jkl")).toMatch(/gsk_/);
    expect(looksLikeSecret("xai-abcdef1234567890")).toMatch(/xai-/);
    expect(looksLikeSecret("AIzaSyAbc123def456ghi789")).toMatch(/AIza/);
    expect(looksLikeSecret("hf_abcdef1234567890abcdef")).toMatch(/hf_/);
  });

  it("detects whitespace in env-var names", () => {
    expect(looksLikeSecret("MY API KEY")).toMatch(/whitespace/);
  });

  it("flags non-UPPER_SNAKE_CASE names", () => {
    expect(looksLikeSecret("MyApiKey")).toMatch(/UPPER_SNAKE_CASE/);
    expect(looksLikeSecret("my.api.key")).toMatch(/UPPER_SNAKE_CASE/);
  });

  it("returns null for valid env-var names", () => {
    expect(looksLikeSecret("OPENAI_API_KEY")).toBeNull();
    expect(looksLikeSecret("ANTHROPIC_OAUTH_TOKEN")).toBeNull();
    expect(looksLikeSecret("VOLCANO_API_KEY")).toBeNull();
    expect(looksLikeSecret("X1")).toBeNull();
  });

  it("returns null for empty / undefined", () => {
    expect(looksLikeSecret(undefined)).toBeNull();
    expect(looksLikeSecret("")).toBeNull();
  });
});