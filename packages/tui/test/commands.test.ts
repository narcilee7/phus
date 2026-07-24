// test/tui/commands.test.ts
// Verify that `runSlash` dispatches the correct actions for each slash
// command and returns the right SlashResult for /quit / /clear.

import { describe, expect, it, vi } from "vitest";
import { runSlash } from "../src/handler/commands/commands.js";
import { initialState, type AppAction, type AppState } from "../src/state/state.js";
import type { PhusAgent } from "../src/bridge/pi-agent.js";

// ─── Mock agent ─────────────────────────────────────────────────

function makeAgent(over: Partial<PhusAgent> = {}): PhusAgent {
  const skill = {
    name: "demo",
    description: "demo skill",
    body: "demo body",
    location: "./skills/demo",
    source: "user",
    metadata: { version: "1", author: "phus" },
    createdAt: 0,
  };
  const defaults: any = {
    getMesh: () => undefined,
    getAllSkills: () => [skill],
    getSkill: (name: string) => (name === "demo" ? skill : undefined),
    getCurrentModel: () => ({ provider: "anthropic", id: "claude-sonnet-4-20250514" }),
    setModel: vi.fn(async () => {}),
    getThinkingLevel: () => "medium",
    setThinkingLevel: vi.fn(),
    getTapeStats: () => ({
      totalEntries: 42,
      sessions: { "cli:default": 30, "cli:other": 12 },
    }),
    getSkillsPrompt: () => "- demo (v1, by phus) demo skill",
    getMessageCount: () => 7,
    getTapeSummary: () => "(empty)",
    getCurrentSessionId: () => "cli:default" as any,
    setNextSessionId: vi.fn(),
    compactCurrentSession: async () => "compacted: summarized=5, kept=3",
    clearConversation: async () => {},
    replayTape: function* () {},
    restoreCheckpoint: vi.fn(async () => {}),
    saveCheckpoint: vi.fn(),
    listCheckpoints: vi.fn(() => []),
    interrupt: vi.fn(),
    loadPluginsForReload: async () => ({ skills: 1, plugins: 0, pluginStatus: [] }),
    getPolicy: () => [{ toolName: "bash", evaluate: () => ({ allow: true }) } as any],
    getTapeTotalEntries: () => 42,
    getSkillCount: () => 1,
    getPlanRunner: () => undefined,
    getPlanStore: () => undefined,
    listSessions: () => [
      {
        id: "cli:default",
        kind: "conversation",
        status: "open",
        origin: { channel: "cli", scope: "legacy", conversationKey: "default" },
        tags: [],
        metadata: {},
        createdAt: 0,
        updatedAt: 0,
        lastTurnAt: 0,
      } as any,
      {
        id: "cli:other",
        kind: "conversation",
        status: "open",
        origin: { channel: "cli", scope: "legacy", conversationKey: "other" },
        tags: [],
        metadata: {},
        createdAt: 0,
        updatedAt: 0,
        lastTurnAt: 0,
      } as any,
    ],
    getSession: (id: string) => ({
      id,
      kind: "conversation",
      status: "open",
      origin: { channel: "cli", scope: "legacy", conversationKey: "default" },
      tags: [],
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
      lastTurnAt: 0,
    } as any),
  };
  return { ...defaults, ...over } as any;
}

// ─── Helpers ───────────────────────────────────────────────────

function captureDispatch() {
  const dispatched: AppAction[] = [];
  const dispatch = (a: AppAction) => dispatched.push(a);
  return { dispatch, dispatched };
}

function getSystemText(dispatched: AppAction[]): string {
  const sys = dispatched.filter((a) => a.type === "add_system");
  return sys.map((a) => (a as any).text).join("\n");
}

// ─── Tests ─────────────────────────────────────────────────────

describe("runSlash — quit / clear", () => {
  it("/quit returns 'quit'", async () => {
    const agent = makeAgent();
    const { dispatch } = captureDispatch();
    expect(await runSlash("/quit", agent, initialState, dispatch)).toBe("quit");
  });

  it("/exit returns 'quit'", async () => {
    const agent = makeAgent();
    const { dispatch } = captureDispatch();
    expect(await runSlash("/exit", agent, initialState, dispatch)).toBe("quit");
  });

  it("/clear returns 'clear'", async () => {
    const agent = makeAgent();
    const { dispatch } = captureDispatch();
    expect(await runSlash("/clear", agent, initialState, dispatch)).toBe("clear");
  });

  it("plain text without / or , prefix is a no-op", async () => {
    const agent = makeAgent();
    const { dispatch, dispatched } = captureDispatch();
    const result = await runSlash("hello world", agent, initialState, dispatch);
    expect(result).toBeUndefined();
    expect(dispatched).toEqual([]);
  });
});

describe("runSlash — /help", () => {
  it("dispatches add_system with the help text", async () => {
    const agent = makeAgent();
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/help", agent, initialState, dispatch);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: "add_system", level: "info" });
    const text = getSystemText(dispatched);
    expect(text).toContain("/model");
    expect(text).toContain("/skills");
    expect(text).toContain("/quit");
  });
});

describe("runSlash — /model", () => {
  it("with no arg shows current model", async () => {
    const agent = makeAgent();
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/model", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("anthropic/claude-sonnet-4-20250514");
  });

  it("with provider/modelId calls setModel + dispatches confirmation", async () => {
    const setModel = vi.fn(async () => {});
    const agent = makeAgent({ setModel } as any);
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/model openai/gpt-4o", agent, initialState, dispatch);
    expect(setModel).toHaveBeenCalledWith("gpt-4o", "openai");
    expect(getSystemText(dispatched)).toContain("✓ model switched to openai/gpt-4o");
  });

  it("with malformed arg warns usage", async () => {
    const agent = makeAgent();
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/model openai", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("usage:");
  });
});

describe("runSlash — /reasoning", () => {
  it("with no arg shows current level", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/reasoning", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("current: medium");
  });

  it("with valid level calls setThinkingLevel", async () => {
    const setThinkingLevel = vi.fn();
    const agent = makeAgent({ setThinkingLevel } as any);
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/reasoning high", agent, initialState, dispatch);
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(getSystemText(dispatched)).toContain("✓ thinking level = high");
  });

  it("with invalid level warns", async () => {
    const setThinkingLevel = vi.fn();
    const agent = makeAgent({ setThinkingLevel } as any);
    const { dispatch, dispatched } = captureDispatch();
    await runSlash("/reasoning banana", agent, initialState, dispatch);
    expect(setThinkingLevel).not.toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("invalid level");
  });
});

describe("runSlash — /skills / /skill-read / /plugins", () => {
  it("/skills lists loaded skills", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/skills", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("demo");
    expect(getSystemText(dispatched)).toContain("demo skill");
  });

  it("/skill-read with valid name prints body", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/skill-read demo", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("demo body");
  });

  it("/skill-read with missing name warns", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/skill-read", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("usage:");
  });

  it("/skill-read with unknown skill warns", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/skill-read ghost", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("skill not found: ghost");
  });

  it("/plugins directs users outside TUI", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plugins", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("phus plugins-list");
  });
});

describe("runSlash — /tape / /sessions / /trace", () => {
  it("/tape shows tape stats JSON", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/tape", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("totalEntries");
  });

  it("/sessions lists sessions from the catalog", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/sessions", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("cli:defa");
    expect(getSystemText(dispatched)).toContain("cli:legacy:default");
    expect(getSystemText(dispatched)).toContain("open");
  });

  it("/trace with N replays up to N turns", async () => {
    const turnEntry = (id: string) => ({
      kind: "turn",
      turn: {
        id,
        ts: Date.now(),
        sessionId: "s" as any,
        inbound: { id, from: "user", content: "x", type: "text", channel: "tui", metadata: {}, ts: 0 } as any,
        prompt: "x",
        modelOutput: "y",
        toolCalls: [],
        outbound: [],
      },
    });
    function* replayGen() {
      yield turnEntry("t1");
      yield turnEntry("t2");
      yield turnEntry("t3");
    }
    const agent = makeAgent({ replayTape: replayGen } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/trace 2", agent, initialState, dispatch);
    const lines = getSystemText(dispatched).split("\n");
    // 2 lines (one per turn) — newest first
    expect(lines).toHaveLength(2);
  });
});

describe("runSlash — /use / /compact", () => {
  it("/use with id calls setNextSessionId", async () => {
    const setNextSessionId = vi.fn();
    const agent = makeAgent({ setNextSessionId } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/use cli:default", agent, initialState, dispatch);
    expect(setNextSessionId).toHaveBeenCalledTimes(1);
    expect(getSystemText(dispatched)).toContain("active session");
  });

  it("/use without arg warns usage", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/use", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("usage:");
  });

  it("/compact calls compactCurrentSession + dispatches result", async () => {
    const compactCurrentSession = vi.fn(async () => "compacted: summarized=5, kept=3");
    const agent = makeAgent({ compactCurrentSession } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/compact", agent, initialState, dispatch);
    expect(compactCurrentSession).toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("compacted: summarized=5");
  });

  it("/compact warns when there is no active session", async () => {
    const agent = makeAgent({ getCurrentSessionId: () => undefined } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/compact", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("no active session");
  });
});

describe("runSlash — /context / /policy / /health / /reload", () => {
  it("/context prints model + skills + tape", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/context", agent, initialState, dispatch);
    const text = getSystemText(dispatched);
    expect(text).toContain("model: anthropic/claude-sonnet-4-20250514");
    expect(text).toContain("thinking: medium");
    expect(text).toContain("messages: 7");
    expect(text).toContain("demo");
  });

  it("/policy lists rules", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/policy", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("- bash");
  });

  it("/reload calls loadPluginsForReload", async () => {
    const loadPluginsForReload = vi.fn(async () => ({ skills: 2, plugins: 1, pluginStatus: [] }));
    const agent = makeAgent({ loadPluginsForReload } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/reload", agent, initialState, dispatch);
    expect(loadPluginsForReload).toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("✓ reloaded: 2 skills, 1 plugins");
  });

  it("/interrupt calls agent.interrupt + dispatches warning", async () => {
    const interrupt = vi.fn();
    const agent = makeAgent({ interrupt } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/interrupt", agent, initialState, dispatch);
    expect(interrupt).toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("✓ current turn aborted");
  });

  it("/undo restores checkpoint for current session + clears items", async () => {
    const restoreCheckpoint = vi.fn(async () => {});
    const agent = makeAgent({ restoreCheckpoint } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/undo", agent, initialState, dispatch);
    expect(restoreCheckpoint).toHaveBeenCalledWith("cli:default");
    expect(dispatched.some((a) => a.type === "clear_items")).toBe(true);
    expect(getSystemText(dispatched)).toContain("✓ restored to last checkpoint");
  });

  it("/undo warns when there is no active session", async () => {
    const agent = makeAgent({ getCurrentSessionId: () => undefined } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/undo", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("no active session");
  });

  it("/checkpoint list shows checkpoints for current session", async () => {
    const listCheckpoints = vi.fn(() => [
      { ts: Date.now() * 1000, messages: [1, 2, 3] },
      { ts: (Date.now() - 1000) * 1000, messages: [1, 2] },
    ]);
    const agent = makeAgent({ listCheckpoints } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/checkpoint list", agent, initialState, dispatch);
    expect(listCheckpoints).toHaveBeenCalledWith("cli:default");
    expect(getSystemText(dispatched)).toContain("1.");
    expect(getSystemText(dispatched)).toContain("3 messages");
  });

  it("/checkpoint create saves a checkpoint", async () => {
    const saveCheckpoint = vi.fn();
    const agent = makeAgent({ saveCheckpoint } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/checkpoint create", agent, initialState, dispatch);
    expect(saveCheckpoint).toHaveBeenCalledWith("cli:default");
    expect(getSystemText(dispatched)).toContain("✓ checkpoint created");
  });

  it("/checkpoint restore restores the selected checkpoint", async () => {
    const restoreCheckpoint = vi.fn(async () => {});
    const listCheckpoints = vi.fn(() => [
      { ts: Date.now() * 1000, messages: [1, 2, 3] },
      { ts: (Date.now() - 1000) * 1000, messages: [1, 2] },
    ]);
    const agent = makeAgent({ restoreCheckpoint, listCheckpoints } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/checkpoint restore 2", agent, initialState, dispatch);
    expect(restoreCheckpoint).toHaveBeenCalledWith("cli:default");
    expect(dispatched.some((a) => a.type === "clear_items")).toBe(true);
    expect(getSystemText(dispatched)).toContain("✓ restored to checkpoint");
  });

  it("/checkpoint restore warns for invalid index", async () => {
    const listCheckpoints = vi.fn(() => [{ ts: Date.now() * 1000, messages: [] }]);
    const agent = makeAgent({ listCheckpoints } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/checkpoint restore 5", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("checkpoint 5 not found");
  });

  it("/checkpoint warns when there is no active session", async () => {
    const agent = makeAgent({ getCurrentSessionId: () => undefined } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/checkpoint list", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("no active session");
  });

  it("/forget clears conversation + dispatches confirmation", async () => {
    const clearConversation = vi.fn(async () => {});
    const agent = makeAgent({ clearConversation } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/forget", agent, initialState, dispatch);
    expect(clearConversation).toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("conversation cleared");
  });

  it("/new clears + resets items", async () => {
    const clearConversation = vi.fn(async () => {});
    const agent = makeAgent({ clearConversation } as any);
    const stateWithItems: AppState = {
      ...initialState,
      items: [{ id: "old", kind: "user", text: "previous", ts: 0 }],
    };
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/new", agent, stateWithItems, dispatch);
    expect(clearConversation).toHaveBeenCalled();
    // Should contain clear_items
    expect(dispatched.some((a) => a.type === "clear_items")).toBe(true);
  });

  it("/reload propagates errors to the user", async () => {
    const loadPluginsForReload = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const agent = makeAgent({ loadPluginsForReload } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/reload", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("permission denied");
  });
});

describe("runSlash — /plan", () => {
  it("/plan create runs a new plan and dispatches result", async () => {
    const createAndRun = vi.fn(async () => ({
      id: "p1",
      status: "completed",
      steps: [{ id: "s1", description: "step", status: "completed" }],
    }));
    const agent = makeAgent({
      getPlanRunner: () => ({ createAndRun } as any),
      getPlanStore: () => ({ loadActiveForSession: () => undefined } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan create refactor auth", agent, initialState, dispatch);
    expect(createAndRun).toHaveBeenCalledWith("refactor auth", "cli:default");
    expect(getSystemText(dispatched)).toContain("p1");
    expect(getSystemText(dispatched)).toContain("completed");
  });

  it("/plan create warns when no goal is provided", async () => {
    const agent = makeAgent({
      getPlanRunner: () => ({ createAndRun: vi.fn() } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan create", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("usage: /plan create <goal>");
  });

  it("/plan status shows active plan", async () => {
    const agent = makeAgent({
      getPlanStore: () => ({
        loadActiveForSession: () => ({
          id: "p1",
          status: "running",
          goal: "refactor auth",
          steps: [
            { id: "s1", description: "step 1", status: "completed" },
            { id: "s2", description: "step 2", status: "running" },
          ],
        }),
      } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan status", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("p1: running [1/2] refactor auth");
  });

  it("/plan list shows plans for the session", async () => {
    const agent = makeAgent({
      getPlanStore: () => ({
        loadBySession: () => [
          { id: "p1", status: "completed", goal: "refactor auth", steps: [{ status: "completed" }] },
        ],
      } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan list", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("p1");
    expect(getSystemText(dispatched)).toContain("refactor auth");
  });

  it("/plan run executes an existing plan", async () => {
    const runPlan = vi.fn(async () => ({ id: "p1", status: "completed" }));
    const agent = makeAgent({
      getPlanRunner: () => ({ runPlan } as any),
      getPlanStore: () => ({
        load: (id: string) =>
          id === "p1"
            ? { id: "p1", status: "pending", goal: "refactor auth", steps: [] }
            : undefined,
      } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan run p1", agent, initialState, dispatch);
    expect(runPlan).toHaveBeenCalled();
    expect(getSystemText(dispatched)).toContain("p1");
  });

  it("/plan resume runs the active plan", async () => {
    const runPlan = vi.fn(async () => ({ id: "p1", status: "completed" }));
    const agent = makeAgent({
      getPlanRunner: () => ({ runPlan } as any),
      getPlanStore: () => ({
        loadActiveForSession: () => ({ id: "p1", status: "running", goal: "refactor auth", steps: [] }),
      } as any),
    } as any);
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/plan resume", agent, initialState, dispatch);
    expect(runPlan).toHaveBeenCalled();
  });
});

describe("runSlash — unknown command", () => {
  it("dispatches add_system 'unknown command'", async () => {
    const agent = makeAgent();
    const { dispatched, dispatch } = captureDispatch();
    await runSlash("/nosuchcmd", agent, initialState, dispatch);
    expect(getSystemText(dispatched)).toContain("unknown command: /nosuchcmd");
  });
});