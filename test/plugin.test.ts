// test/plugin.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HookRegistry } from "../src/core/runtime/hook.js";

describe("plugin loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-plugin-"));
    process.env.PHUS_HOME = dir;
  });

  afterEach(() => {
    delete process.env.PHUS_HOME;
  });

  it("discovers plugins from $PHUS_HOME/plugins/<name>.ts", async () => {
    const pluginsDir = path.join(dir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, "my-plugin.ts"),
      `import { logger } from "../../src/core/logger.ts";
export default {
  name: "my-plugin",
  register(ctx) {
    ctx.hooks.register("test_hook", async () => "hello", { mode: "first_result" });
  },
};`,
    );

    const { loadPlugins } = await import("../src/infra/plugins/loader.js");
    const hooks = new HookRegistry();
    const channels: any[] = [];
    const loaded = loadPlugins(hooks, channels);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe("my-plugin");
    expect(loaded[0]?.status).toBe("ok");

    const ctx = { sessionId: "s", state: {}, tape: {} as any, skills: {} as any, extras: {} };
    const r = await hooks.execute("test_hook", ctx, "first_result");
    expect(r).toBe("hello");
  });

  it("discovers plugins from phus.config.yaml", async () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      `plugins:
  - name: cfg-plugin
    path: ./custom-plugin.ts
`,
    );
    fs.writeFileSync(
      path.join(dir, "custom-plugin.ts"),
      `export default { name: "cfg-plugin", register() {} };`,
    );

    const { loadPlugins } = await import("../src/infra/plugins/loader.js");
    const hooks = new HookRegistry();
    const loaded = loadPlugins(hooks, []);
    expect(loaded.some((p) => p.name === "cfg-plugin")).toBe(true);
  });

  it("reports error when plugin file is malformed", async () => {
    const pluginsDir = path.join(dir, "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, "bad.ts"), `this is not valid TS !!!`);

    const { loadPlugins } = await import("../src/infra/plugins/loader.js");
    const loaded = loadPlugins(new HookRegistry(), []);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe("error");
    expect(loaded[0]?.error).toBeDefined();
  });

  it("returns empty list when no plugins exist", async () => {
    const { loadPlugins } = await import("../src/infra/plugins/loader.js");
    const loaded = loadPlugins(new HookRegistry(), []);
    expect(loaded).toHaveLength(0);
  });
});
