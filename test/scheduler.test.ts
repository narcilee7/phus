// test/scheduler.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { Scheduler, nextFires, type Schedule } from "../src/core/scheduler.js";
import { HookRegistry, makeCtx } from "../src/core/hook.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Tape } from "../src/core/tape.js";
import { SkillRegistry } from "../src/core/skills/skill.js";

function makeHooks(): { hooks: HookRegistry; tape: Tape; skills: SkillRegistry; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-sched-"));
  const tape = new Tape(path.join(dir, "tape.sqlite"));
  const skills = new SkillRegistry(path.join(dir, "skills"));
  const hooks = new HookRegistry();
  return { hooks, tape, skills, dir };
}

describe("Scheduler", () => {
  it("registers a schedule with valid cron", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    s.register({ name: "every-minute", cron: "* * * * *", hookName: "system_prompt" });
    expect(s.list()).toHaveLength(1);
    expect(s.get("every-minute")?.cron).toBe("* * * * *");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid cron", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    expect(() => s.register({ name: "bad", cron: "not-a-cron", hookName: "system_prompt" })).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects duplicate names", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    s.register({ name: "x", cron: "* * * * *", hookName: "system_prompt" });
    expect(() => s.register({ name: "x", cron: "* * * * *", hookName: "system_prompt" })).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("enable/disable toggle", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    s.register({ name: "x", cron: "* * * * *", hookName: "system_prompt" });
    expect(s.setEnabled("x", false)).toBe(true);
    expect(s.get("x")?.enabled).toBe(false);
    expect(s.setEnabled("x", true)).toBe(true);
    expect(s.get("x")?.enabled).toBe(true);
    expect(s.setEnabled("nonexistent", false)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("unregister removes", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    s.register({ name: "x", cron: "* * * * *", hookName: "system_prompt" });
    expect(s.unregister("x")).toBe(true);
    expect(s.list()).toHaveLength(0);
    expect(s.unregister("x")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tick fires a registered hook", async () => {
    const { hooks, tape, skills, dir } = makeHooks();
    const fired: any[] = [];
    hooks.register("system_prompt", async (ctx) => {
      fired.push((ctx.extras as any).schedule);
    }, { mode: "broadcast" });

    const s = new Scheduler(hooks, {
      tickIntervalMs: 10_000_000,  // effectively disable auto-tick
      onFire: (f) => fired.push(f.schedule.name + ":onFire"),
    });
    s.register({ name: "every-minute", cron: "* * * * *", hookName: "system_prompt" });
    await s.tick();

    expect(fired).toContain("every-minute");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tick does not fire disabled schedules", async () => {
    const { hooks, dir } = makeHooks();
    let n = 0;
    hooks.register("system_prompt", async () => { n++; }, { mode: "broadcast" });
    const s = new Scheduler(hooks);
    s.register({ name: "x", cron: "* * * * *", hookName: "system_prompt", enabled: false });
    await s.tick();
    expect(n).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("start/stop are idempotent", () => {
    const { hooks, dir } = makeHooks();
    const s = new Scheduler(hooks);
    s.start();
    s.start(); // should not error
    s.stop();
    s.stop(); // should not error
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("nextFires", () => {
  it("returns N future fire times", () => {
    const start = new Date("2026-07-15T10:00:00Z");
    const fires = nextFires("* * * * *", 5, start);
    expect(fires).toHaveLength(5);
    // Each should be 1 minute apart
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i]!.getTime() - fires[i - 1]!.getTime()).toBe(60_000);
    }
  });

  it("respects complex cron", () => {
    const start = new Date("2026-07-15T10:00:00Z");
    const fires = nextFires("0 * * * *", 3, start); // top of every hour
    expect(fires).toHaveLength(3);
    expect(fires[0]!.getUTCHours()).toBe(11);
    expect(fires[0]!.getUTCMinutes()).toBe(0);
  });
});
