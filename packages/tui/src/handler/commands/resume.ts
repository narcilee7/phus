// src/tui/handler/commands/resume.ts
// /resume — pop the paused-plan picker explicitly. Replaces the old
// startup-time auto-prompt (which stole focus before the user typed
// anything). TUI hint at boot:
//   "N paused plans available — type /resume to continue"

import type { CommandRegistry } from "./context.js";
import { notify } from "./notice.js";

export function registerResume(): CommandRegistry {
  return {
    async resume(_arg, { agent, dispatch, ui }) {
      const paused = agent.getInterruptedPlans();
      if (paused.length === 0) {
        notify(dispatch, "no paused plans — nothing to resume", "info");
        return;
      }
      if (!ui?.openResumePrompt) {
        // Fallback for callers that didn't wire the UI hook (e.g. tests,
        // gateway dispatch). Surface the list instead of silently
        // doing nothing.
        const lines = paused
          .slice(0, 10)
          .map((p) => `· ${p.id.slice(0, 8)}  ${p.goal.slice(0, 60)}  (${p.status})`);
        notify(dispatch, `${paused.length} paused plan(s):\n${lines.join("\n")}`);
        return;
      }
      ui.openResumePrompt();
    },
  };
}