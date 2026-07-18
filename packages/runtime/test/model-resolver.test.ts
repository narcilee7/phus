// test/model-resolver.test.ts
// API-key resolution for the active profile.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveModel, resolveApiKey } from "../src/bridge/model-resolver";

const mockProfile = vi.fn();
const mockModel = vi.fn();

vi.mock("../src/infra/config/index", () => ({
  loadConfig: vi.fn(() => ({ profileName: "default" })),
}));

vi.mock("../src/infra/profile", () => ({
  resolveProfile: vi.fn((name) => mockProfile(name)),
  modelFromProfile: vi.fn((p) => mockModel(p)),
  apiKeyForProfile: vi.fn((p) => p.apiKey ?? (p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined)),
}));

describe("model-resolver", () => {
  beforeEach(() => {
    mockProfile.mockReset();
    mockModel.mockReset();
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("sets provider API_KEY env var from inline apiKey", () => {
    mockProfile.mockReturnValue({
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "sk-inline",
    });
    mockModel.mockReturnValue({ provider: "deepseek", id: "deepseek-v4-flash" });

    resolveModel();
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-inline");
  });

  it("sets provider API_KEY env var from apiKeyEnv", () => {
    process.env.MY_DEEPSEEK_KEY = "sk-env";
    mockProfile.mockReturnValue({
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKeyEnv: "MY_DEEPSEEK_KEY",
    });
    mockModel.mockReturnValue({ provider: "deepseek", id: "deepseek-v4-flash" });

    resolveModel();
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-env");
    delete process.env.MY_DEEPSEEK_KEY;
  });

  it("throws a helpful error when no API key is available", () => {
    mockProfile.mockReturnValue({
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
    });
    mockModel.mockReturnValue({ provider: "deepseek", id: "deepseek-v4-flash" });

    expect(() => resolveModel()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("resolveApiKey returns inline apiKey", () => {
    mockProfile.mockReturnValue({
      name: "default",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "sk-inline",
    });
    expect(resolveApiKey("deepseek")).toBe("sk-inline");
  });
});
