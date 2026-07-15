// test/health.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { healthCheck } from "../src/commands/health.js";

describe("healthCheck", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-health-"));
    process.env.PHUS_TAPE_DB = path.join(dir, "tape.sqlite");
    process.env.PHUS_SKILLS_DIR = path.join(dir, "skills");
    process.env.PHUS_LOG_FILE = path.join(dir, "logs", "phus.jsonl");
  });

  afterEach(() => {
    delete process.env.PHUS_TAPE_DB;
    delete process.env.PHUS_SKILLS_DIR;
    delete process.env.PHUS_LOG_FILE;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns ok=false when no provider key is set", () => {
    const s = healthCheck();
    expect(s.ok).toBe(false);
    expect(s.checks.provider_key?.ok).toBe(false);
  });

  it("returns ok=true when all checks pass", () => {
    // Create files so existence checks pass.
    fs.writeFileSync(process.env.PHUS_TAPE_DB!, "");
    fs.mkdirSync(process.env.PHUS_SKILLS_DIR!, { recursive: true });
    fs.mkdirSync(path.dirname(process.env.PHUS_LOG_FILE!), { recursive: true });
    fs.writeFileSync(process.env.PHUS_LOG_FILE!, "");

    process.env.OPENAI_API_KEY = "test-key";

    const s = healthCheck();
    expect(s.checks.tape_db?.ok).toBe(true);
    expect(s.checks.skills_dir?.ok).toBe(true);
    expect(s.checks.provider_key?.ok).toBe(true);
    expect(s.checks.log_file?.ok).toBe(true);
    expect(s.ok).toBe(true);
  });
});
