// test/subagent-timeout.test.ts
// A hung sub-agent loop must not stall a plan forever — the wall-clock
// race aborts it and throws SubAgentTimeoutError.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SubAgent, SubAgentTimeoutError } from "../src/core/runtime/subagent/index.js";
import type { SubAgentAgentLike } from "../src/core/runtime/subagent/types.js";
import { resetConfigCache } from "../src/infra/config/index.js";
import { asSessionId } from "@phus/core/types/brand.js";

describe("SubAgent timeout", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.PHUS_HOME;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-subagent-"));
    process.env.PHUS_HOME = dir;
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "robustness:\n  subagentTimeoutMs: 20\n");
    resetConfigCache();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PHUS_HOME;
    else process.env.PHUS_HOME = prevHome;
    resetConfigCache();
  });

  function stuckAgent(): SubAgentAgentLike & { aborted: boolean } {
  // Mock a parent that spawns a sibling Agent whose prompt()
  // never settles. The timeout race should fire and abort us.
  return {
    aborted: false,
    getSkillsPrompt: () => "",
    getTools: () => [],
    getAbortSignal: () => new AbortController().signal,
    spawnSubAgent: () => {
      const sibling: any = {
        state: { messages: [] },
        sessionId: "sub",
        prompt: () => new Promise(() => {}), // never resolves
        continue: () => new Promise(() => {}), // never resolves
        abort: () => {},
      };
      return sibling;
    },
    abort() { this.aborted = true; },
  } as unknown as SubAgentAgentLike & { aborted: boolean };
}

  it("aborts and throws SubAgentTimeoutError when the sibling prompt never resolves", async () => {
    const agent = stuckAgent();
    const sub = new SubAgent({ agent });
    await expect(
      sub.run({ task: "do something", parentSessionId: "parent" }),
    ).rejects.toBeInstanceOf(SubAgentTimeoutError);
    expect(agent.aborted).toBe(true);
  });
});
