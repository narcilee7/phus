// test/env-file.test.ts
// Minimal dotenv-style loader for $PHUS_HOME/.env.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFile } from "../src/infra/env-file.js";

describe("loadEnvFile", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "phus-env-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it("loads KEY=VALUE pairs into process.env", () => {
    writeFileSync(path.join(tmpDir, ".env"), "DEEPSEEK_API_KEY=sk-test\n");
    delete process.env.DEEPSEEK_API_KEY;
    loadEnvFile(tmpDir);
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-test");
  });

  it("does not overwrite existing env vars", () => {
    writeFileSync(path.join(tmpDir, ".env"), "DEEPSEEK_API_KEY=sk-new\n");
    process.env.DEEPSEEK_API_KEY = "sk-existing";
    loadEnvFile(tmpDir);
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-existing");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(
      path.join(tmpDir, ".env"),
      "\n# comment\nDEEPSEEK_API_KEY=sk-test\n\n",
    );
    delete process.env.DEEPSEEK_API_KEY;
    loadEnvFile(tmpDir);
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-test");
  });

  it("strips surrounding quotes", () => {
    writeFileSync(path.join(tmpDir, ".env"), 'DEEPSEEK_API_KEY="sk-test"\n');
    delete process.env.DEEPSEEK_API_KEY;
    loadEnvFile(tmpDir);
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-test");
  });

  it("does nothing when .env is missing", () => {
    delete process.env.DEEPSEEK_API_KEY;
    loadEnvFile(tmpDir);
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
  });
});
