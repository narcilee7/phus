// test/subagent-timeout.test.ts
// A hung sub-agent loop must not stall a plan forever — the wall-clock
// race aborts it and throws SubAgentTimeoutError.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
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
    return {
      aborted: false,
      steer() {},
      waitForIdle: () => new Promise<void>(() => {}), // never idles
      getCurrentSessionId: () => asSessionId("parent"),
      setNextSessionId() {},
      subscribeToAgentEvents: () => () => {},
      // runTurn that never settles — the timeout race should fire
      // and abort us.
      runTurn: () => new Promise<AgentMessage[]>(() => {}),
      abort() { this.aborted = true; },
    };
  }

  it("aborts and throws SubAgentTimeoutError when runTurn never resolves", async () => {
    const agent = stuckAgent();
    const sub = new SubAgent({ agent });
    await expect(
      sub.run({ task: "do something", parentSessionId: "parent" }),
    ).rejects.toBeInstanceOf(SubAgentTimeoutError);
    expect(agent.aborted).toBe(true);
  });
});
