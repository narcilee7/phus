// test/config.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  DEFAULTS,
  interpolateEnv,
  extractVarRefs,
  ConfigError,
  loadConfig,
  resetConfigCache,
  configPath,
  resolvePhusHome,
  findMonorepoRoot,
  setLogSink,
} from "../src/infra/config/index";

describe("DEFAULTS", () => {
  it("has the canonical fallback values used by the loader", () => {
    expect(DEFAULTS.home).toBe("./.phus");
    expect(DEFAULTS.tapeDb).toBe("./tape.sqlite");
    expect(DEFAULTS.skillsDir).toBe("./skills");
    expect(DEFAULTS.logFile).toBe("./logs/phus.jsonl");
    expect(DEFAULTS.logLevel).toBe("info");
    expect(DEFAULTS.defaultProfile).toBe("default");
    expect(DEFAULTS.defaultModel).toContain("/");
  });
});

describe("interpolateEnv", () => {
  it("expands ${VAR}", () => {
    process.env.MY_TEST_VAR = "hello";
    expect(interpolateEnv("${MY_TEST_VAR}")).toBe("hello");
    delete process.env.MY_TEST_VAR;
  });

  it("expands ${VAR:-default} when unset", () => {
    delete process.env.MISSING_VAR;
    expect(interpolateEnv("${MISSING_VAR:-fallback}")).toBe("fallback");
  });

  it("expands ${VAR:-default} prefers real env over default", () => {
    process.env.PRESENT_VAR = "real";
    expect(interpolateEnv("${PRESENT_VAR:-fallback}")).toBe("real");
    delete process.env.PRESENT_VAR;
  });

  it("expands bare $VAR (after non-identifier char or start of string)", () => {
    process.env.BARE = "ok";
    expect(interpolateEnv("prefix $BARE suffix")).toBe("prefix ok suffix");
    delete process.env.BARE;
  });

  it("does NOT expand $VAR when preceded by an identifier char", () => {
    process.env.FOO_BAR = "should-not-appear";
    expect(interpolateEnv("foo$FOO_BAR")).toBe("foo$FOO_BAR");
    delete process.env.FOO_BAR;
  });

  it("leaves literal ${UNSET} and emits one warn per distinct name", () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const warned = new Set<string>();
    const result = interpolateEnv(["${X}", "${X}", "${Y}"], {
      warn: (event, fields) => events.push({ event, fields }),
      warned,
    }) as string[];
    expect(result).toEqual(["${X}", "${X}", "${Y}"]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.event)).toEqual(["config.interpolate_unset", "config.interpolate_unset"]);
    expect(events.map((e) => e.fields.var)).toEqual(["X", "Y"]);
  });

  it("throws ConfigError when onUnset is 'error'", () => {
    expect(() => interpolateEnv("${NOWAY}", { onUnset: "error" })).toThrow(ConfigError);
  });

  it("leaves literal silently when onUnset is 'leave'", () => {
    delete process.env.PHUS_CONFIG_TEST_UNSET;
    const events: Array<{ event: string }> = [];
    const result = interpolateEnv("${PHUS_CONFIG_TEST_UNSET}", {
      onUnset: "leave",
      warn: (event) => events.push({ event }),
    });
    expect(result).toBe("${PHUS_CONFIG_TEST_UNSET}");
    expect(events).toHaveLength(0);
  });

  it("treats $$ and \\$ as escape for literal $", () => {
    expect(interpolateEnv("cost: $$5")).toBe("cost: $5");
    expect(interpolateEnv("price: \\$10")).toBe("price: $10");
  });

  it("walks objects recursively, leaves keys untouched", () => {
    process.env.SECRET = "s3cr3t";
    const out = interpolateEnv({
      apiKey: "${SECRET}",
      nested: { token: "${SECRET}" },
      list: ["${SECRET}", 42, null, true],
      arrayKey: ["${SECRET}"],
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("s3cr3t");
    expect((out.nested as Record<string, unknown>).token).toBe("s3cr3t");
    expect((out.list as unknown[])[0]).toBe("s3cr3t");
    expect((out.list as unknown[])[1]).toBe(42);
    expect((out.list as unknown[])[2]).toBeNull();
    expect((out.list as unknown[])[3]).toBe(true);
    expect((out.arrayKey as unknown[])[0]).toBe("s3cr3t");
    delete process.env.SECRET;
  });

  it("detect cycles via in-progress set", () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const result = interpolateEnv("${A}", {
      warn: (event, fields) => events.push({ event, fields }),
      inProgress: new Set(["A"]),
    });
    expect(result).toBe("${A}");
    expect(events).toEqual([
      { event: "config.interpolate_cycle", fields: { var: "A", source: undefined } },
    ]);
  });
});

describe("extractVarRefs", () => {
  it("returns sorted unique variable names", () => {
    process.env.A = "1";
    process.env.B = "2";
    const refs = extractVarRefs({ a: "${A}", b: ["${B}", "$A", "${A}"] });
    expect(refs).toEqual(["A", "B"]);
    delete process.env.A;
    delete process.env.B;
  });
});

describe("loadConfig", () => {
  let dir: string;
  /** Snapshot of every env var we touch, restored in afterEach. */
  const envSnapshot = new Map<string, string | undefined>();
  const ENV_KEYS_TO_SNAPSHOT = [
    "PHUS_HOME",
    "PHUS_LOG_LEVEL",
    "PHUS_LOG_FILE",
    "PHUS_PROFILE",
    "PHUS_MODEL",
    "PHUS_BASE_URL",
    "PHUS_MODEL_ID",
  ];
  const recorded: Array<{ event: string; fields: Record<string, unknown> }> = [];

  beforeEach(() => {
    for (const k of ENV_KEYS_TO_SNAPSHOT) envSnapshot.set(k, process.env[k]);
    for (const k of ENV_KEYS_TO_SNAPSHOT) delete process.env[k];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "phus-config-"));
    process.env.PHUS_HOME = dir;
    resetConfigCache();
    recorded.length = 0;
    setLogSink((event, fields) => recorded.push({ event, fields }));
  });

  afterEach(() => {
    for (const [k, v] of envSnapshot) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigCache();
    setLogSink(() => {});
  });

  it("returns defaults-filled config when no file exists", () => {
    const cfg = loadConfig();
    expect(cfg.paths.home).toBe(dir);
    expect(cfg.paths.tapeDb).toBe(DEFAULTS.tapeDb);
    expect(cfg.paths.skillsDir).toBe(DEFAULTS.skillsDir);
    expect(cfg.log.file).toBe(DEFAULTS.logFile);
    expect(cfg.log.level).toBe(DEFAULTS.logLevel);
    expect(cfg.profileName).toBe(DEFAULTS.defaultProfile);
    expect(cfg.source.present).toBe(false);
    expect(recorded.some((r) => r.event === "config.file_missing")).toBe(true);
  });

  it("reads paths, log, providers, plugins, schedules from YAML", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      [
        "paths:",
        "  tapeDb: ./data/tape.sqlite",
        "  skillsDir: ./data/skills",
        "log:",
        "  file: ./data/phus.jsonl",
        "  level: debug",
        "providers:",
        "  defaultProfile: fast",
        "  profiles:",
        "    fast:",
        "      provider: openai",
        "      modelId: gpt-4o-mini",
        "      description: cheap",
        "plugins:",
        "  - name: foo",
        "    path: ./plugins/foo.ts",
        "    config: { debug: true }",
        "  - ./plugins/bar.ts",
        "schedules:",
        "  - name: heartbeat",
        "    cron: '*/5 * * * *'",
        "    hookName: system_prompt",
      ].join("\n"),
    );

    const cfg = loadConfig();
    expect(cfg.paths.tapeDb).toBe("./data/tape.sqlite");
    expect(cfg.paths.skillsDir).toBe("./data/skills");
    expect(cfg.log.file).toBe("./data/phus.jsonl");
    expect(cfg.log.level).toBe("debug");
    expect(cfg.profileName).toBe("fast");
    expect(cfg.providers.profiles.fast).toBeDefined();
    expect(cfg.providers.profiles.fast?.provider).toBe("openai");
    expect(cfg.providers.profiles.fast?.modelId).toBe("gpt-4o-mini");
    expect(cfg.plugins).toHaveLength(2);
    expect(cfg.plugins[0]?.path).toBe("./plugins/foo.ts");
    expect((cfg.plugins[0]?.config as { debug: boolean } | undefined)?.debug).toBe(true);
    expect(cfg.plugins[1]?.path).toBe("./plugins/bar.ts");
    expect(cfg.schedules).toHaveLength(1);
    expect(cfg.schedules[0]?.name).toBe("heartbeat");
    expect(cfg.source.present).toBe(true);
  });

  it("interpolates ${VAR} from environment", () => {
    process.env.TEST_INTERPOLATE = "resolved";
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      "paths:\n  tapeDb: ${TEST_INTERPOLATE}/tape.sqlite\n",
    );
    const cfg = loadConfig();
    expect(cfg.paths.tapeDb).toBe("resolved/tape.sqlite");
    delete process.env.TEST_INTERPOLATE;
  });

  it("warns about env overrides for PHUS_HOME / PHUS_LOG_* / PHUS_PROFILE", () => {
    process.env.PHUS_LOG_LEVEL = "trace";
    process.env.PHUS_PROFILE = "foo";
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: info\n");

    const cfg = loadConfig();
    expect(cfg.log.level).toBe("trace");
    expect(cfg.profileName).toBe("foo");
    const overrides = recorded.filter((r) => r.event === "config.env_override_used");
    const overriddenVars = overrides.map((r) => r.fields.var as string);
    expect(overriddenVars).toContain("PHUS_LOG_LEVEL");
    expect(overriddenVars).toContain("PHUS_PROFILE");
  });

  it("warns only once per env-override var across multiple loads", () => {
    process.env.PHUS_LOG_LEVEL = "warn";
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: info\n");

    loadConfig();
    // Bump mtime to force reload.
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(dir, "phus.config.yaml"), future, future);
    loadConfig();
    const overrides = recorded.filter((r) => r.event === "config.env_override_used");
    const logOverrides = overrides.filter((r) => r.fields.var === "PHUS_LOG_LEVEL");
    expect(logOverrides).toHaveLength(1);
  });

  it("caches by mtime; forceReload bypasses cache", () => {
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: info\n");
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toBe(b);
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: error\n");
    const c = loadConfig();
    // Same mtime might not change within the second — so use forceReload to be sure.
    const d = loadConfig({ forceReload: true });
    expect(d.log.level).toBe("error");
    void c;
  });

  it("resetConfigCache forces a re-read", () => {
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: info\n");
    const a = loadConfig();
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: warn\n");
    resetConfigCache();
    const b = loadConfig();
    expect(a).not.toBe(b);
    expect(b.log.level).toBe("warn");
  });

  it("falls back to DEFAULTS when log.level is invalid", () => {
    fs.writeFileSync(path.join(dir, "phus.config.yaml"), "log:\n  level: bogus\n");
    const cfg = loadConfig();
    expect(cfg.log.level).toBe(DEFAULTS.logLevel);
  });

  it("configPath() returns the resolved absolute path", () => {
    expect(configPath()).toBe(path.join(dir, "phus.config.yaml"));
  });

  it("emits config.model.not_in_registry for unknown gateway modelIds with baseUrl", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      [
        "providers:",
        "  defaultProfile: gateway",
        "  profiles:",
        "    gateway:",
        "      provider: openai",
        "      modelId: ep-20241120-abc123",
        "      baseUrl: https://ark.cn-beijing.volces.com/api/v3",
      ].join("\n"),
    );
    loadConfig();
    const events = recorded.filter((r) => r.event === "config.model.not_in_registry");
    expect(events).toHaveLength(1);
    expect(events[0]?.fields.provider).toBe("openai");
    expect(events[0]?.fields.modelId).toBe("ep-20241120-abc123");
    expect(events[0]?.fields.hint).toMatch(/custom gateway/);
  });

  it("emits config.apiKeyEnv.looks_like_secret for inline secrets", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      [
        "providers:",
        "  defaultProfile: oops",
        "  profiles:",
        "    oops:",
        "      provider: anthropic",
        "      modelId: claude-sonnet-4-20250514",
        "      apiKeyEnv: sk-ant-api03-abcdef1234567890",
      ].join("\n"),
    );
    loadConfig();
    const events = recorded.filter((r) => r.event === "config.apiKeyEnv.looks_like_secret");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.fields.reason).toMatch(/sk-ant-/);
  });

  it("drops a profile that is missing provider or modelId", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      [
        "providers:",
        "  defaultProfile: broken",
        "  profiles:",
        "    broken:",
        "      model: claude-sonnet-4",     // no provider segment
      ].join("\n"),
    );
    const cfg = loadConfig();
    expect(cfg.providers.profiles.broken).toBeUndefined();
  });

  it("drops a mesh entry that lacks provider", () => {
    fs.writeFileSync(
      path.join(dir, "phus.config.yaml"),
      [
        "providers:",
        "  defaultProfile: broken",
        "  profiles:",
        "    broken:",
        "      provider: anthropic",
        "      modelId: claude-sonnet-4-20250514",
        "      mesh:",
        "        - modelId: gpt-4o-mini",     // no provider
      ].join("\n"),
    );
    const cfg = loadConfig();
    expect(cfg.providers.profiles.broken?.mesh).toHaveLength(0);
  });
});

describe("resolvePhusHome (Issues.md #2)", () => {
  const savedHome = process.env.PHUS_HOME;
  beforeEach(() => {
    delete process.env.PHUS_HOME;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.PHUS_HOME;
    else process.env.PHUS_HOME = savedHome;
    resetConfigCache();
  });

  it("honors an absolute $PHUS_HOME verbatim", () => {
    process.env.PHUS_HOME = "/tmp/abs-phus-home";
    expect(resolvePhusHome()).toBe("/tmp/abs-phus-home");
  });

  it("resolves a relative $PHUS_HOME against cwd", () => {
    process.env.PHUS_HOME = "rel/.phus";
    expect(resolvePhusHome()).toBe(path.resolve("rel/.phus"));
  });

  it("falls back to the phus monorepo root when $PHUS_HOME is unset", () => {
    // vitest runs from packages/runtime/, which lives inside the phus
    // monorepo. Walking upward should find pnpm-workspace.yaml at the
    // repo root.
    const home = resolvePhusHome();
    expect(home.endsWith(`${path.sep}.phus`)).toBe(true);
    expect(path.dirname(home)).toBe(findMonorepoRoot());
  });
});

describe("findMonorepoRoot", () => {
  it("returns the repo root when invoked from any subdirectory of the phus monorepo", () => {
    // The runtime test process itself runs from packages/runtime/, so a
    // no-arg call should find pnpm-workspace.yaml upward.
    const root = findMonorepoRoot();
    expect(root).toBeDefined();
    expect(fs.existsSync(path.join(root!, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("returns undefined when invoked from a directory without an ancestor anchor", () => {
    // Simulate walking upward by temporarily chdir-ing into a fresh
    // tmpfs dir with no pnpm-workspace.yaml above it. Vitest cleans up
    // the tmp dir; we restore cwd.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phus-no-mono-"));
    const original = process.cwd();
    try {
      process.chdir(tmp);
      expect(findMonorepoRoot()).toBeUndefined();
    } finally {
      process.chdir(original);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});