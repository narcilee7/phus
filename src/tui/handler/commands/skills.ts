// src/tui/handler/commands/skills.ts
// Skill discovery and inspection plus plugin metadata.

import type { CommandRegistry } from "@/tui/handler/commands/context.js";
import { notify } from "@/tui/handler/commands/notice.js";

export function registerSkills(): CommandRegistry {
  return {
    skills(_arg, { agent, dispatch }) {
      const list = agent.getAllSkills();
      if (list.length === 0) {
        notify(dispatch, "no skills loaded — ask the agent to write one with skill_write");
        return;
      }
      notify(
        dispatch,
        list
          .map(
            (s) =>
              `  ${s.name} (v${s.metadata.version ?? "?"}, by ${s.metadata.author ?? "?"})  ${s.description}`,
          )
          .join("\n"),
      );
    },

    "skill-read"(arg, { agent, dispatch }) {
      if (!arg) {
        notify(dispatch, "usage: /skill-read <name>", "warn");
        return;
      }
      const skill = agent.getSkill(arg);
      if (!skill) {
        notify(dispatch, `skill not found: ${arg}`, "warn");
        return;
      }
      notify(
        dispatch,
        `${skill.name} (v${skill.metadata.version ?? "?"})\n${skill.description}\n\n${skill.body}`,
      );
    },

    plugins(_arg, { dispatch }) {
      notify(
        dispatch,
        "plugin system: see `phus plugins-list` outside TUI\n(runtime plugin reload: /reload)",
      );
    },
  };
}
