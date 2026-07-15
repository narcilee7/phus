// test/logger.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("logger", () => {
  let dir: string;
  let logFile: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-log-"));
    logFile = path.join(dir, "phus.jsonl");
    process.env.PHUS_LOG_FILE = logFile;
    process.env.PHUS_LOG_LEVEL = "debug";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PHUS_LOG_FILE;
    delete process.env.PHUS_LOG_LEVEL;
    vi.resetModules();
  });

  it("writes structured JSON lines to PHUS_LOG_FILE", async () => {
    const { logger } = await import("../src/core/logger.js");
    logger.info("test.event", { foo: "bar", n: 42 });

    await new Promise((r) => setTimeout(r, 100));

    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.event).toBe("test.event");
    expect(entry.level).toBe("info");
    expect(entry.foo).toBe("bar");
    expect(entry.n).toBe(42);
    expect(entry.service).toBe("phus");
  });

  it("respects PHUS_LOG_LEVEL threshold", async () => {
    process.env.PHUS_LOG_LEVEL = "warn";
    const { logger } = await import("../src/core/logger.js");
    logger.debug("test.debug");
    logger.warn("test.warn");
    await new Promise((r) => setTimeout(r, 100));
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).event).toBe("test.warn");
  });
});
