// test/tui/theme.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@phus/runtime/infra/config/index.js", () => ({
  loadConfig: () => ({ theme: "high-contrast" }),
}));

import { getTheme, resolveThemeName, animationDisabled } from "../src/theme/theme.js";

describe("theme", () => {
  it("respects PHUS_THEME env var", () => {
    vi.stubEnv("PHUS_THEME", "light");
    expect(resolveThemeName()).toBe("light");
    vi.unstubAllEnvs();
  });

  it("falls back to config.theme when env is unset", () => {
    expect(resolveThemeName()).toBe("high-contrast");
  });

  it("returns a palette with expected keys", () => {
    const t = getTheme();
    expect(t.accent).toBeTruthy();
    expect(t.success).toBeTruthy();
    expect(t.danger).toBeTruthy();
    expect(t.diffAdd).toBeTruthy();
    expect(t.diffDel).toBeTruthy();
  });
});

describe("animationDisabled", () => {
  it("is true when PHUS_NO_ANIM=1", () => {
    vi.stubEnv("PHUS_NO_ANIM", "1");
    expect(animationDisabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
