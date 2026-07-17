// src/cli/commands/plugins-list.ts
// `phus plugins-list` — list discovered plugins (without loading them).

import type { Command } from "commander";
import { loadConfig } from "@/infra/config/index.js";
import { HookRegistry } from "@/core/runtime/hook/registry";

export function registerPluginsListCommand(program: Command): void {
  program
    .command("plugins-list")
    .description("List discovered plugins from $PHUS_HOME/plugins and phus.config.yaml")
    .action(async () => {
      const { loadPlugins } = await import("@/infra/plugins/loader.js");
      const hooks = new HookRegistry();
      const channels: import("@/channels/base.js").ChannelAdapter[] = [];
      const loaded = loadPlugins(hooks, channels);
      if (loaded.length === 0) {
        const home = loadConfig().paths.home;
        console.log("No plugins found.");
        console.log(`Search paths: $PHUS_HOME/plugins/  (PHUS_HOME=${home})`);
        console.log(`Config file:  $PHUS_HOME/phus.config.yaml`);
        return;
      }
      for (const p of loaded) {
        const mark = p.status === "ok" ? "✅" : "❌";
        console.log(`${mark} ${p.name}  ${p.path}${p.error ? `  — ${p.error}` : ""}`);
      }
    });
}
