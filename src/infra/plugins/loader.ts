// src/core/plugin.ts
// File-based plugin discovery
// Plugins live in:
//   - $PHUS_HOME/plugins/<name>.ts        (user plugins)
//   - $PHUS_HOME/plugins/<name>/index.ts  (directory style)
//   - phus.config.yaml :: plugins: [paths]
//
// Each plugin exports a default object implementing Plugin. Loading uses
// @mariozechner/jiti so plugins can be authored as TypeScript without a build step.

import * as fs from "node:fs";
import * as path from "node:path";
import { createJiti } from "jiti";
import * as yaml from "yaml";
import { logger } from "@/infra/logging.js";
import type { HookRegistry } from "@/core/runtime/hook.js";
import type { ChannelAdapter } from "@/channels/base.js";
import { LoadedPlugin, Plugin, PluginContext, PluginLoaderOptions } from "@/types/plugins/index.js";
import { Skill } from "@/types/skill.js";
import { enqueuePendingCliCommand } from "@/infra/plugins/cli-queue.js";
import { loadConfig } from "@/infra/config/index.js";

export function loadPlugins(
  hooks: HookRegistry,
  channels: ChannelAdapter[],
  skills: { registerRuntime?: (skill: Skill) => void } = {},
  opts: PluginLoaderOptions = {},
): LoadedPlugin[] {
  const home = opts.home ?? loadConfig().paths.home;
  const results: LoadedPlugin[] = [];

  // 1. Discover plugin paths.
  const pluginPaths = discoverPluginPaths(home, opts.configFile);

  if (pluginPaths.length === 0) {
    logger.debug("plugin.no_plugins_found", { home });
    return results;
  }

  // 2. Set up jiti for TS loading.
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    fsCache: false,
    moduleCache: false,
  });

  // 3. Load each plugin.
  for (const { name, path: pluginPath, config } of pluginPaths) {
    try {
      const mod = jiti(pluginPath) as { default?: Plugin } & Plugin;
      const plugin: Plugin = (mod as any).default ?? (mod as Plugin);
      if (!plugin || typeof plugin.register !== "function") {
        throw new Error("plugin must export default { name, register(ctx) }");
      }
      const ctx: PluginContext = {
        hooks,
        registerSkill: (s) => skills.registerRuntime?.(s),
        registerChannel: (c) => channels.push(c),
        registerInternalCommand: (cmd) => {
          // Lazy import to avoid circular dep
          import("@/core/runtime/internal-commands/index.js").then((m) => m.register(cmd));
        },
        registerCliCommand: (fn) => {
          // Lazy: collect into a queue; phus.ts drains it at startup
          enqueuePendingCliCommand(fn);
        },
        config,
      };
      const result = plugin.register(ctx);
      if (result && typeof (result as any).then === "function") {
        // async plugin — fire and forget but log
        (result as Promise<void>).catch((err) =>
          logger.error("plugin.register_async_failed", { plugin: name, error: err.message }),
        );
      }
      results.push({ name, path: pluginPath, status: "ok" });
      logger.info("plugin.loaded", { name, path: pluginPath });
    } catch (err: any) {
      results.push({ name, path: pluginPath, status: "error", error: err.message });
      logger.error("plugin.load_failed", { name, path: pluginPath, error: err.message });
    }
  }

  return results;
}

function discoverPluginPaths(
  home: string,
  configFile?: string,
): Array<{ name: string; path: string; config: unknown }> {
  const out: Array<{ name: string; path: string; config: unknown }> = [];

  // 1. From phus.config.yaml
  const cfgPath = configFile ?? path.join(home, "phus.config.yaml");
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = yaml.parse(fs.readFileSync(cfgPath, "utf-8")) as {
        plugins?: Array<string | { name?: string; path: string; config?: unknown }>;
      };
      for (const p of cfg.plugins ?? []) {
        if (typeof p === "string") {
          const resolved = path.isAbsolute(p) ? p : path.resolve(home, p);
          out.push({ name: path.basename(resolved, path.extname(resolved)), path: resolved, config: {} });
        } else if (p.path) {
          const resolved = path.isAbsolute(p.path) ? p.path : path.resolve(home, p.path);
          out.push({ name: p.name ?? path.basename(resolved, path.extname(resolved)), path: resolved, config: p.config ?? {} });
        }
      }
    } catch (err) {
      logger.error("plugin.config_parse_failed", { path: cfgPath, error: (err as Error).message });
    }
  }

  // 2. From $PHUS_HOME/plugins/ (skip names already added via config)
  const pluginsDir = path.join(home, "plugins");
  if (fs.existsSync(pluginsDir)) {
    const seen = new Set(out.map((p) => path.resolve(p.path)));
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      let candidate: string | undefined;
      if (entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name)) {
        candidate = path.join(pluginsDir, entry.name);
      } else if (entry.isDirectory()) {
        const idx = path.join(pluginsDir, entry.name, "index.ts");
        if (fs.existsSync(idx)) candidate = idx;
      }
      if (candidate && !seen.has(path.resolve(candidate))) {
        out.push({ name: entry.name.replace(/\.(ts|js|mjs|cjs)$/, ""), path: candidate, config: {} });
      }
    }
  }

  return out;
}
