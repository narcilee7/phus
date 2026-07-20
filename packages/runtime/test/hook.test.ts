// test/hook.test.ts
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HookRegistry } from "../src/core/runtime/hook/registry";
import { makeCtx } from "../src/core/runtime/hook/ctx-builder";
import { Tape } from "@phus/core/session/tape";
import { SkillRegistry } from "../src/infra/skills/registry";

function tmpCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-hook-"));
  const tape = new Tape(path.join(dir, "tape.sqlite"));
  const skills = new SkillRegistry(path.join(dir, "skills"));
  return { dir, tape, skills, ctx: makeCtx({ sessionId: "s", state: {}, tape, skills }) };
}

describe("HookRegistry", () => {
  it("first_result returns the first non-null result", async () => {
    const { ctx } = tmpCtx();
    const reg = new HookRegistry();
    reg.register("x", async () => undefined, { mode: "first_result", priority: 0 });
    reg.register("x", async () => "hit", { mode: "first_result", priority: 1 });
    const r = await reg.execute("x", ctx, "first_result");
    expect(r).toBe("hit");
  });

  it("first_result returns undefined when nothing matches", async () => {
    const { ctx } = tmpCtx();
    const reg = new HookRegistry();
    reg.register("x", async () => null, { mode: "first_result", priority: 0 });
    const r = await reg.execute("x", ctx, "first_result");
    expect(r).toBeUndefined();
  });

  it("chain pipes output through implementations in priority order", async () => {
    const { ctx } = tmpCtx();
    const reg = new HookRegistry();
    reg.register("x", async (c) => ({ ...c, n: ((c as any).n ?? 0) + 1 }), { mode: "chain", priority: 1 });
    reg.register("x", async (c) => ({ ...c, n: ((c as any).n ?? 0) * 10 }), { mode: "chain", priority: 0 });
    const r = await reg.execute("x", ctx, "chain");
    expect((r as any).n).toBe(10); // (0+1)*10
  });

  it("broadcast collects all non-null results in priority order", async () => {
    const { ctx } = tmpCtx();
    const reg = new HookRegistry();
    reg.register("x", async () => "a", { mode: "broadcast", priority: 0 });
    reg.register("x", async () => "b", { mode: "broadcast", priority: 1 });
    const r = (await reg.execute("x", ctx, "broadcast")) as string[];
    expect(r).toEqual(["b", "a"]);
  });

  it("report() reflects registered hooks", async () => {
    const { ctx } = tmpCtx();
    const reg = new HookRegistry();
    reg.register("resolve_session", async () => "x", { mode: "first_result" });
    const r = reg.report();
    expect(r.resolve_session).toHaveLength(1);
    expect(r.resolve_session[0]?.mode).toBe("first_result");
  });
});
