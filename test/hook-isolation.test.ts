// test/hook-isolation.test.ts
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HookRegistry, makeCtx } from "../src/core/hook.js";
import { Tape } from "../src/core/tape.js";
import { SkillRegistry } from "../src/core/skills/skill.js";

function tmpCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-iso-"));
  const tape = new Tape(path.join(dir, "tape.sqlite"));
  const skills = new SkillRegistry(path.join(dir, "skills"));
  return { dir, tape, skills, ctx: makeCtx({ sessionId: "s", state: {}, tape, skills }) };
}

describe("HookRegistry isolation", () => {
  it("default mode: chain aborts on first throw", async () => {
    const { ctx, dir, tape } = tmpCtx();
    try {
      const reg = new HookRegistry(); // default isolateErrors=false
      reg.register("x", async () => ({ step: 1 }), { mode: "chain", priority: 1 });
      reg.register("x", async () => { throw new Error("boom"); }, { mode: "chain", priority: 0 });
      reg.register("x", async () => ({ step: 3 }), { mode: "chain", priority: -1 });
      await expect(reg.execute("x", ctx, "chain")).rejects.toThrow("boom");
      tape.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("isolateErrors=true: chain continues past throws", async () => {
    const { ctx, dir, tape } = tmpCtx();
    try {
      const reg = new HookRegistry({ isolateErrors: true });
      reg.register("x", async (c) => ({ ...c, step: 1 }), { mode: "chain", priority: 1 });
      reg.register("x", async () => { throw new Error("boom"); }, { mode: "chain", priority: 0 });
      reg.register("x", async (c) => ({ ...c, step: 3 }), { mode: "chain", priority: -1 });
      const result: any = await reg.execute("x", ctx, "chain");
      // Step 3 should still run; chain carried the prior value forward.
      expect(result.step).toBe(3);
      tape.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("isolateErrors=true: broadcast continues past throws", async () => {
    const { ctx, dir, tape } = tmpCtx();
    try {
      const reg = new HookRegistry({ isolateErrors: true });
      reg.register("x", async () => "a", { mode: "broadcast" });
      reg.register("x", async () => { throw new Error("boom"); }, { mode: "broadcast" });
      reg.register("x", async () => "c", { mode: "broadcast" });
      const result = (await reg.execute("x", ctx, "broadcast")) as string[];
      expect(result).toContain("a");
      expect(result).toContain("c");
      expect(result).not.toContain("boom");
      tape.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("isolateErrors=true: first_result skips throws and continues", async () => {
    const { ctx, dir, tape } = tmpCtx();
    try {
      const reg = new HookRegistry({ isolateErrors: true });
      reg.register("x", async () => { throw new Error("boom"); }, { mode: "first_result", priority: 1 });
      reg.register("x", async () => "found", { mode: "first_result", priority: 0 });
      const r = await reg.execute("x", ctx, "first_result");
      expect(r).toBe("found");
      tape.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
