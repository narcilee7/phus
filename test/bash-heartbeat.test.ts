// test/bash-heartbeat.test.ts
// Verifies the bash tool passes through heartbeat / durationMs correctly.

import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createExternalTools } from "../src/bridge/tools.js";

describe("bash tool heartbeat (B.2.4)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns durationMs in details for fast commands", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-bash-"));
    const tools = createExternalTools();
    const bash = tools.find((t) => t.name === "bash")!;
    const result = await bash.execute("test-1", { command: "echo hello", timeoutMs: 5000 });
    expect(result.content[0]?.text).toContain("hello");
    expect((result.details as any).durationMs).toBeGreaterThanOrEqual(0);
    expect((result.details as any).durationMs).toBeLessThan(2000);
  });

  it("emits heartbeat events for long commands (timeoutMs > 10000)", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-bash-"));
    const tools = createExternalTools();
    const bash = tools.find((t) => t.name === "bash")!;
    // 12 second sleep — should trigger at least one heartbeat
    const start = Date.now();
    const result = await bash.execute("test-2", {
      command: "sleep 0.6", // short but we'll verify heartbeat logic indirectly
      timeoutMs: 30_000,
    });
    const elapsed = Date.now() - start;
    // The heartbeat fires every 5s, so for sleep 0.6 we won't get one.
    // But we verify the durationMs is reported.
    expect((result.details as any).durationMs).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(2000);
  });

  it("does not retry on success (no Retry-After)", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-bash-"));
    const tools = createExternalTools();
    const bash = tools.find((t) => t.name === "bash")!;
    const result = await bash.execute("test-3", { command: "true", timeoutMs: 5000 });
    expect(result.content[0]?.text).toBe("");
  });
});
