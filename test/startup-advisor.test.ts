import { describe, expect, it } from "vitest";
import { StartupAdvisor } from "@/core/runtime/startup-advisor.js";
import type { TapeLike } from "@/types/hooks/index.js";
import { asSessionId } from "@/types/brand.js";

function makeTape(entries: unknown[] = []): TapeLike {
  return {
    append: () => {},
    replay: function* () {
      for (const entry of entries) yield entry as any;
    },
    summary: () => "",
    stats: () => ({ totalEntries: entries.length, sessions: {} }),
    loadAnchor: () => undefined,
  };
}

describe("StartupAdvisor", () => {
  it("suggests startup script from tape goals", async () => {
    const advisor = new StartupAdvisor();
    const tape = makeTape([
      {
        kind: "turn",
        turn: {
          id: "t1",
          ts: 1,
          sessionId: asSessionId("session-1"),
          inbound: { from: "user", content: "Daily standup summary", channel: "cli", ts: 1 },
          prompt: "Daily standup summary",
          modelOutput: "summary here",
          toolCalls: [],
          outbound: [],
        },
      } as any,
    ]);

    const script = await advisor.suggestStartup(tape);

    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("Daily standup summary");
    expect(script).toContain("phus run --once");
  });

  it("includes plan goals when present", async () => {
    const advisor = new StartupAdvisor();
    const tape = makeTape([
      {
        kind: "plan",
        sessionId: asSessionId("session-1"),
        plan: {
          id: "p1",
          sessionId: asSessionId("session-1"),
          goal: "Weekly report",
          status: "completed",
          steps: [],
          createdAt: 1,
          updatedAt: 2,
        },
        ts: 1,
      } as any,
    ]);

    const script = await advisor.suggestStartup(tape);
    expect(script).toContain("Weekly report");
  });
});
