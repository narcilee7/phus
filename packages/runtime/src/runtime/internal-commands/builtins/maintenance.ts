// src/core/internal-commands/builtins/maintenance.ts
// ,reload / ,plugins / ,policy / ,context / ,clear / ,quit —
// runtime introspection and REPL control.

import * as fs from "node:fs";
import * as path from "node:path";
import type { InternalCommand, InternalCommandServices } from "../types";
import { healthCheck } from "@/commands/health";

export function defineMaintenanceCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "reload",
      description: "reload skills and plugins from disk",
      handler: async () => {
        const channels = services.extraChannels?.() ?? [];
        const { skills, plugins } = await services.agent.reloadSkillsAndPlugins(channels);
        return `✓ reloaded: ${skills} skills, ${plugins} plugins`;
      },
    },
    {
      name: "plugins",
      description: "list loaded plugins",
      handler: async () => {
        const channels = services.extraChannels?.() ?? [];
        const { pluginStatus } = await services.agent.reloadSkillsAndPlugins(channels);
        if (pluginStatus.length === 0) return "(no plugins loaded)";
        return pluginStatus
          .map((p) => `  ${p.ok ? "✓" : "✗"} ${p.name}  ${p.path}`)
          .join("\n");
      },
    },
    {
      name: "policy",
      description: "show active safety policy",
      handler: async () => {
        const rules = services.agent.getPolicy();
        return (
          `policy rules:\n${rules.map((r) => `  - ${r.toolName}`).join("\n")}\n\n` +
          `file_write roots: ./skills, ./.phus, ./tmp, ./out\n` +
          `bash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`
        );
      },
    },
    {
      name: "context",
      description: "show system prompt + skills + tape summary that gets injected",
      handler: async () => {
        const d = services.agent.getDiagnostics();
        const skills = services.agent.getSkillsPrompt();
        const tapeSum = services.agent.getTapeSummary(d.sessionId, 5);
        return [
          `model: ${d.modelLabel}`,
          `thinking: ${d.thinkingLevel}`,
          `messages: ${d.messageCount}`,
          "",
          "── skills ──",
          skills || "(none)",
          "",
          "── recent tape ──",
          tapeSum || "(empty)",
        ].join("\n");
      },
    },
    {
      name: "clear",
      description: "clear the chat area (TUI) or stdout (CLI)",
      handler: async ({ surface }) => {
        if (surface === "cli") {
          process.stdout.write("\x1b[2J\x1b[H");
        }
        return surface === "tui" ? "__CLEAR_TUI__" : null;
      },
    },
    {
      name: "quit",
      description: "exit the REPL",
      handler: async ({ surface }) => {
        return surface === "tui" ? "__QUIT_TUI__" : null;
      },
    },
    {
      name: "health",
      description: "run health check",
      handler: async () => {
        const status = healthCheck();
        const lines = Object.entries(status.checks).map(
          ([k, v]) => `${v.ok ? "✅" : "❌"} ${k}: ${v.detail ?? ""}`,
        );
        return [status.ok ? "✓ healthy" : "✗ unhealthy", ...lines].join("\n");
      },
    },
    {
      name: "version",
      description: "show Phus version",
      handler: async () => {
        try {
          const pkgPath = path.join(process.cwd(), "package.json");
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
          return `phus ${pkg.version ?? "(unknown version)"}`;
        } catch {
          return "phus (unknown version)";
        }
      },
    },
  ];
}
