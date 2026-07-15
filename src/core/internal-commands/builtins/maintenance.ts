// src/core/internal-commands/builtins/maintenance.ts
// ,reload / ,plugins / ,policy / ,context / ,clear / ,quit —
// runtime introspection and REPL control.

import type { InternalCommand, InternalCommandServices } from "../types.js";

export function defineMaintenanceCommands(
  services: InternalCommandServices,
): InternalCommand[] {
  return [
    {
      name: "reload",
      description: "reload skills and plugins from disk",
      handler: async () => {
        const agent = services.getAgent() as any;
        agent._internal.skills.discover();
        const { loadPlugins } = await import("@/core/plugin.js");
        const channels: any[] = [];
        const loaded = loadPlugins(agent._internal.hooks, channels, {
          registerRuntime: () => {},
        });
        return `✓ reloaded: ${agent._internal.skills.getAll().length} skills, ${loaded.length} plugins`;
      },
    },
    {
      name: "plugins",
      description: "list loaded plugins",
      handler: async () => {
        const { loadPlugins } = await import("@/core/plugin.js");
        const agent = services.getAgent() as any;
        const channels: any[] = [];
        const loaded = loadPlugins(agent._internal.hooks, channels, {
          registerRuntime: () => {},
        });
        if (loaded.length === 0) return "(no plugins loaded)";
        return loaded
          .map((p: any) => `  ${p.status === "ok" ? "✓" : "✗"} ${p.name}  ${p.path}`)
          .join("\n");
      },
    },
    {
      name: "policy",
      description: "show active safety policy",
      handler: async () => {
        const rules = (services.getAgent() as any)._internal.policy;
        return (
          `policy rules:\n${rules.map((r: any) => `  - ${r.toolName}`).join("\n")}\n\n` +
          `file_write roots: ./skills, ./.phus, ./tmp, ./out\n` +
          `bash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`
        );
      },
    },
    {
      name: "context",
      description: "show system prompt + skills + tape summary that gets injected",
      handler: async () => {
        const agent = services.getAgent() as any;
        const m = agent._internal.piAgent.state.model;
        const skills = agent._internal.skills.toPromptContext();
        const tapeSum = agent._internal.tape.summary(
          agent._currentSessionId ?? "default",
          5,
        );
        return [
          `model: ${m.provider}/${m.id}`,
          `thinking: ${agent._internal.piAgent.state.thinkingLevel}`,
          `messages: ${agent._internal.piAgent.state.messages.length}`,
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
  ];
}