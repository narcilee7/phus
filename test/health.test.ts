// test/health.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "yaml";
import { healthCheck } from "../src/commands/health.js";
import { resetConfigCache } from "../src/infra/config/index.js";

describe("healthCheck", () => {
  let dir: string;
  let originalPhusHome: string | undefined;

  beforeEach(() => {
    originalPhusHome = process.env.PHUS_HOME;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-health-"));
    process.env.PHUS_HOME = dir;

    // Write an explicit config so loadConfig() resolves paths inside the temp
    // directory regardless of defaults or cwd.
    const cfg = {
      paths: {
        tapeDb: path.join(dir, "tape.sqlite"),
        skillsDir: path.join(dir, "skills"),
      },
      log: {
        file: path.join(dir, "logs", "phus.jsonl"),
      },
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), yaml.stringify(cfg), "utf-8");

    resetConfigCache();
  });

  afterEach(() => {
    if (originalPhusHome === undefined) {
      delete process.env.PHUS_HOME;
    } else {
      process.env.PHUS_HOME = originalPhusHome;
    }
    delete process.env.OPENAI_API_KEY;
    resetConfigCache();
  });

  it("returns ok=false when no provider key is set", () => {
    const s = healthCheck();
    expect(s.ok).toBe(false);
    expect(s.checks.provider_key?.ok).toBe(false);
  });

  it("returns ok=true when all checks pass", () => {
    const cfg = yaml.parse(fs.readFileSync(path.join(dir, "phus.config.yaml"), "utf-8")) as {
      paths: { tapeDb: string; skillsDir: string };
      log: { file: string };
    };

    // Create files so existence checks pass.
    fs.writeFileSync(cfg.paths.tapeDb, "");
    fs.mkdirSync(cfg.paths.skillsDir, { recursive: true });
    fs.mkdirSync(path.dirname(cfg.log.file), { recursive: true });
    fs.writeFileSync(cfg.log.file, "");

    process.env.OPENAI_API_KEY = "test-key";

    const s = healthCheck();
    expect(s.checks.tape_db?.ok).toBe(true);
    expect(s.checks.skills_dir?.ok).toBe(true);
    expect(s.checks.provider_key?.ok).toBe(true);
    expect(s.checks.log_file?.ok).toBe(true);
    expect(s.ok).toBe(true);
  });
});
