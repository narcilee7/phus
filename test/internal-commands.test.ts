// test/internal-commands.test.ts
import { describe, expect, it } from "vitest";
import { parse, register, unregister, execute, list, renderHelp } from "../src/core/internal-commands.js";

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

describe("register / unregister", () => {
  it("registers and lists commands", () => {
    register({
      name: "test1",
      description: "test",
      handler: async () => "ok",
    });
    expect(list().find((c) => c.name === "test1")).toBeDefined();
    unregister("test1");
    expect(list().find((c) => c.name === "test1")).toBeUndefined();
  });

  it("throws on duplicate without replace", () => {
    register({ name: "dupe", description: "", handler: async () => "ok" });
    expect(() => register({ name: "dupe", description: "", handler: async () => "ok" })).toThrow();
    unregister("dupe");
  });

  it("replaces with replace=true", () => {
    register({ name: "rep", description: "old", handler: async () => "old" });
    register({ name: "rep", description: "new", handler: async () => "new" }, { replace: true });
    expect(list().find((c) => c.name === "rep")?.description).toBe("new");
    unregister("rep");
  });
});

describe("execute", () => {
  it("returns 'not-a-command' for non-command lines", async () => {
    expect(await execute("hello")).toBe("not-a-command");
    expect(await execute("/slash")).toBe("not-a-command");
  });

  it("returns error string for unknown commands", async () => {
    const result = await execute(",nosuchcommand");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("unknown command");
  });

  it("calls the registered handler", async () => {
    register({
      name: "echo",
      description: "echo arg",
      handler: async ({ args }) => `got: ${args.msg ?? ""}`,
    });
    expect(await execute(",echo msg=hi")).toBe("got: hi");
    unregister("echo");
  });

  it("catches handler errors", async () => {
    register({
      name: "boom",
      description: "always fails",
      handler: async () => { throw new Error("nope"); },
    });
    const result = await execute(",boom");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("error in ,boom");
    unregister("boom");
  });
});

describe("renderHelp", () => {
  it("includes command name + description", () => {
    register({ name: "testhelp", description: "test desc", handler: async () => "" });
    const out = renderHelp();
    expect(out).toContain(",testhelp");
    expect(out).toContain("test desc");
    unregister("testhelp");
  });
});
