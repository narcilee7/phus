// test/phase-a-hooks.test.ts
// Integration tests for Phase A.1 (provide_channels) and A.2 (register_cli_commands).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HookRegistry, makeCtx } from "../src/core/runtime/hook.js";
import { Tape } from "../src/core/session/tape.js";
import { SkillRegistry } from "../src/infra/skills/registry.js";
import type { ChannelAdapter } from "../src/channels/base.js";

describe("Phase A.1 provide_channels hook", () => {
  let dir: string;
  let hooks: HookRegistry;
  let tape: Tape;
  let skills: SkillRegistry;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-pch-"));
    tape = new Tape(path.join(dir, "tape.sqlite"));
    skills = new SkillRegistry(path.join(dir, "skills"));
    hooks = new HookRegistry();
  });

  afterEach(() => {
    tape.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("broadcast mode collects channels from all plugins", async () => {
    const fakeA: ChannelAdapter = { name: "fake-a", listen: async () => {}, send: async () => {} };
    const fakeB: ChannelAdapter = { name: "fake-b", listen: async () => {}, send: async () => {} };

    hooks.register("provide_channels", async () => [fakeA], { mode: "broadcast", priority: 0 });
    hooks.register("provide_channels", async () => [fakeB], { mode: "broadcast", priority: 0 });

    const ctx = makeCtx({ sessionId: "", state: {}, tape, skills });
    const contributions = await hooks.execute<ChannelAdapter[][]>("provide_channels", ctx, "broadcast");
    const flat = (contributions ?? []).flat();
    expect(flat.map((c) => c.name).sort()).toEqual(["fake-a", "fake-b"]);
  });

  it("plugins returning undefined don't break the chain", async () => {
    hooks.register("provide_channels", async () => undefined, { mode: "broadcast", priority: 0 });
    hooks.register("provide_channels", async () => [{ name: "real", listen: async () => {}, send: async () => {} }], {
      mode: "broadcast",
      priority: 0,
    });
    const ctx = makeCtx({ sessionId: "", state: {}, tape, skills });
    const contributions = await hooks.execute<ChannelAdapter[][]>("provide_channels", ctx, "broadcast");
    const flat = (contributions ?? []).flat();
    expect(flat).toHaveLength(1);
    expect(flat[0]?.name).toBe("real");
  });
});

describe("Phase A.2 register_cli_commands hook", () => {
  it("broadcast calls all implementations with extras.program", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-rcc-"));
    const tape = new Tape(path.join(dir, "tape.sqlite"));
    const skills = new SkillRegistry(path.join(dir, "skills"));
    const hooks = new HookRegistry();

    const seen: string[] = [];
    const fakeProgram = {
      command: (name: string) => ({
        description: (_d: string) => ({ action: (fn: () => void) => { seen.push(`${name}:fn`); fn(); } }),
      }),
    };

    hooks.register("register_cli_commands", async (ctx) => {
      const program = (ctx.extras as any).program;
      program.command("alpha").description("a").action(() => {});
    }, { mode: "broadcast", priority: 0 });

    hooks.register("register_cli_commands", async (ctx) => {
      const program = (ctx.extras as any).program;
      program.command("beta").description("b").action(() => {});
    }, { mode: "broadcast", priority: 0 });

    const ctx = makeCtx({
      sessionId: "",
      state: {},
      tape,
      skills,
      extras: { program: fakeProgram },
    });
    await hooks.execute("register_cli_commands", ctx, "broadcast");
    expect(seen.sort()).toEqual(["alpha:fn", "beta:fn"]);
    tape.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
