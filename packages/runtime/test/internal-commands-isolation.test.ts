// test/internal-commands-isolation.test.ts
// Verifies that two registries created via createInternalCommandRegistry
// are fully independent — no shared module-level state.

import { describe, expect, it } from "vitest";
import {
  createInternalCommandRegistry,
  registerBuiltins,
  type InternalCommandRegistry,
  type InternalCommandServices,
} from "../src/core/runtime/internal-commands/index";

function makeServices(label: string): InternalCommandServices {
  return {
    agent: {
      getDiagnostics: () => ({
        sessionId: undefined,
        currentSessionOverride: undefined,
        modelLabel: label,
        thinkingLevel: "medium",
        messageCount: 0,
        tapeStats: { totalEntries: 0, sessions: {} },
        skillCount: 0,
      }),
      getHookReport: () => ({}),
      getAllSkills: () => [],
      getSkill: () => undefined,
      getPolicy: () => [],
      getTapeStats: () => ({ totalEntries: 0, sessions: {} }),
      replayTape: function* () {},
      getTapeSummary: () => "",
      reloadSkillsAndPlugins: async () => ({ skills: 0, plugins: 0, pluginStatus: [] }),
      getSkillCount: () => 0,
      getSkillsPrompt: () => "",
      getTapeTotalEntries: () => 0,
      getSessionCount: () => 0,
      getMessageCount: () => 0,
      getTurnCount: () => 0,
      getModelLabel: () => label,
      getCurrentModel: () => ({ provider: "p", id: label }),
      setModel: async () => {},
      getThinkingLevel: () => "medium",
      setThinkingLevel: () => {},
      subscribeToAgentEvents: () => () => {},
      turn: async () => ({}) as any,
      abort: () => {},
      waitForIdle: async () => {},
      steer: () => {},
      followUp: () => {},
      getCurrentSessionId: () => undefined,
      setNextSessionId: () => {},
      reloadSkills: async () => {},
      clearConversation: async () => {},
      compactCurrentSession: async () => "compacted",
      restoreCheckpoint: async () => {},
      interrupt: () => {},
      getMesh: () => undefined,
      loadPluginsForReload: async () => ({ skills: 0, plugins: 0, pluginStatus: [] }),
    } as any,
    home: () => `./.phus-${label}`,
  };
}

describe("createInternalCommandRegistry", () => {
  it("returns two fully independent registries", async () => {
    const r1 = createInternalCommandRegistry(makeServices("alpha"));
    const r2 = createInternalCommandRegistry(makeServices("beta"));
    registerBuiltins(r1);
    registerBuiltins(r2);

    // Register a command only in r1; it must not leak to r2.
    r1.register({
      name: "alpha-only",
      description: "only on alpha",
      handler: async () => "alpha",
    });

    expect(r1.get("alpha-only")).toBeDefined();
    expect(r2.get("alpha-only")).toBeUndefined();

    const r1Count = r1.list().length;
    const r2Count = r2.list().length;
    expect(r1Count).toBeGreaterThan(r2Count);

    // ,tape in each registry uses its own services — both should succeed.
    const t1 = await r1.execute(",tape");
    const t2 = await r2.execute(",tape");
    expect(t1).not.toBe("not-a-command");
    expect(t2).not.toBe("not-a-command");
  });

  it("isolateHandlerErrors: false propagates handler errors", async () => {
    const r: InternalCommandRegistry = createInternalCommandRegistry(
      makeServices("x"),
      { isolateHandlerErrors: false },
    );
    r.register({
      name: "boom",
      description: "fail",
      handler: async () => { throw new Error("kaboom"); },
    });
    await expect(r.execute(",boom")).rejects.toThrow("kaboom");
  });

  it("isolated handler errors return an error string by default", async () => {
    const r = createInternalCommandRegistry(makeServices("x"));
    r.register({
      name: "boom",
      description: "fail",
      handler: async () => { throw new Error("kaboom"); },
    });
    const out = await r.execute(",boom");
    expect(typeof out).toBe("string");
    expect(out as string).toContain("error in ,boom");
  });

  it("renderHelp shows every registered builtin", () => {
    const r = createInternalCommandRegistry(makeServices("x"));
    registerBuiltins(r);
    const help = r.renderHelp();
    for (const name of ["help", "skills", "tape", "trace", "compact", "reload", "policy"]) {
      expect(help).toContain(`,${name}`);
    }
  });
});