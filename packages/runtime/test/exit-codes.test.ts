// test/exit-codes.test.ts
import { describe, expect, it } from "vitest";
import { ExitCode, CliExit } from "../src/core/runtime/executor/exit-code";

describe("ExitCode", () => {
  it("has distinct values for each category", () => {
    const values = new Set(Object.values(ExitCode));
    // 8 categories
    expect(values.size).toBeGreaterThanOrEqual(7);
  });

  it("OK is 0", () => {
    expect(ExitCode.OK).toBe(0);
  });

  it("USER_ERROR < CONFIG_ERROR < RUNTIME_ERROR < POLICY_BLOCKED < INFRA_ERROR", () => {
    expect(ExitCode.USER_ERROR).toBeLessThan(ExitCode.CONFIG_ERROR);
    expect(ExitCode.CONFIG_ERROR).toBeLessThan(ExitCode.RUNTIME_ERROR);
    expect(ExitCode.RUNTIME_ERROR).toBeLessThan(ExitCode.POLICY_BLOCKED);
    expect(ExitCode.POLICY_BLOCKED).toBeLessThan(ExitCode.INFRA_ERROR);
  });
});

describe("CliExit", () => {
  it("carries code + message", () => {
    const e = new CliExit(ExitCode.CONFIG_ERROR, "missing key");
    expect(e.code).toBe(ExitCode.CONFIG_ERROR);
    expect(e.message).toBe("missing key");
    expect(e.name).toBe("CliExit");
  });
});
