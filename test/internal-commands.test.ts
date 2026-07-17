// test/internal-commands.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  parse,
  execute,
  renderHelp,
  register,
  unregister,
  list,
  initInternalCommands,
  _resetInternalCommands,
} from "../src/core/runtime/internal-commands/index.js";

describe("parse", () => {
  it("returns null for non-command lines", () => {
    expect(parse("hello")).toBeNull();
    expect(parse("/slash")).toBeNull();
    expect(parse(",")).toBeNull();
    expect(parse(", ")).toBeNull();
  });

  it("parses bare command", () => {
    expect(parse(",help")).toEqual({ name: "help", args: {}, positional: [] });
  });

  it("parses key=value kwargs", () => {
    expect(parse(",skill name=foo")).toEqual({ name: "skill", args: { name: "foo" }, positional: [] });
  });

  it("parses multiple kwargs", () => {
    expect(parse(",use session=abc key=val")).toEqual({
      name: "use", args: { session: "abc", key: "val" }, positional: [],
    });
  });

  it("parses positional after kwargs", () => {
    expect(parse(",trace 10")).toEqual({ name: "trace", args: {}, positional: ["10"] });
    expect(parse(",skill name=foo bar")).toEqual({
      name: "skill", args: { name: "foo" }, positional: ["bar"],
    });
  });

  it("strips quotes from values", () => {
    expect(parse(',fs.read path="/tmp/file with spaces.txt"')).toEqual({
      name: "fs.read", args: { path: "/tmp/file with spaces.txt" }, positional: [],
    });
    expect(parse(",fs.write path=/tmp/x content='hello world'")).toEqual({
      name: "fs.write", args: { path: "/tmp/x", content: "hello world" }, positional: [],
    });
  });
});

describe("default-registry shim (initInternalCommands + module-level register/execute)", () => {
  /** Minimal PhusAgentFacade stub — every diagnostic method returns a
   *  sensible default. Tests that need real data override individual fields. */
  function makeAgentStub(over: Partial<Record<string, any>> = {}) {
    return {
      getDiagnostics: () => ({
        sessionId: undefined,
        currentSessionOverride: undefined,
        modelLabel: "anthropic/test",
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
      getCurrentSessionId: () => undefined,
      getPlanRunner: () => undefined,
      getPlanStore: () => undefined,
      ...over,
    } as any;
  }

  function initWithAgent(agent: any = makeAgentStub()) {
    initInternalCommands({ agent, home: () => "./.phus" });
  }

  beforeEach(() => {
    _resetInternalCommands();
  });

  it("registers and lists commands via the default registry", () => {
    initWithAgent();
    register({ name: "test1", description: "test", handler: async () => "ok" });
    expect(list().find((c) => c.name === "test1")).toBeDefined();
    unregister("test1");
    expect(list().find((c) => c.name === "test1")).toBeUndefined();
  });

  it("throws on duplicate without replace", () => {
    initWithAgent();
    register({ name: "dupe", description: "", handler: async () => "ok" });
    expect(() => register({ name: "dupe", description: "", handler: async () => "ok" })).toThrow();
    unregister("dupe");
  });

  it("replaces with replace=true", () => {
    initWithAgent();
    register({ name: "rep", description: "old", handler: async () => "old" });
    register({ name: "rep", description: "new", handler: async () => "new" }, { replace: true });
    expect(list().find((c) => c.name === "rep")?.description).toBe("new");
    unregister("rep");
  });

  it("returns 'not-a-command' for non-command lines", async () => {
    initWithAgent();
    expect(await execute("hello")).toBe("not-a-command");
    expect(await execute("/slash")).toBe("not-a-command");
  });

  it("returns error string for unknown commands", async () => {
    initWithAgent();
    const result = await execute(",nosuchcommand");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("unknown command");
  });

  it("calls the registered handler", async () => {
    initWithAgent();
    register({ name: "echo", description: "echo arg", handler: async ({ args }) => `got: ${args.msg ?? ""}` });
    expect(await execute(",echo msg=hi")).toBe("got: hi");
    unregister("echo");
  });

  it("catches handler errors and returns an error string", async () => {
    initWithAgent();
    register({ name: "boom", description: "always fails", handler: async () => { throw new Error("nope"); } });
    const result = await execute(",boom");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("error in ,boom");
    unregister("boom");
  });

  it("renderHelp lists every registered command", () => {
    initWithAgent();
    register({ name: "testhelp", description: "test desc", handler: async () => "" });
    const out = renderHelp();
    expect(out).toContain(",testhelp");
    expect(out).toContain("test desc");
    unregister("testhelp");
  });

  it("the 25 built-in command names are registered after initInternalCommands", () => {
    initWithAgent();
    const expected = [
      "help", "skills", "skill", "skill-review", "skill-review.approve", "skill-review.reject",
      "tape", "trace", "sessions", "use", "compact",
      "fs.read", "fs.write",
      "reload", "plugins", "policy", "context", "clear", "quit",
      "mesh",
      "schedule", "schedule.list", "schedule.add", "schedule.remove", "schedule.enable", "schedule.disable",
      "plan",
    ];
    const names = new Set(list().map((c) => c.name));
    for (const n of expected) {
      expect(names.has(n), `built-in command "${n}" should be registered`).toBe(true);
    }
  });
});