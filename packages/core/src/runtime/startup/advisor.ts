import type { TapeLike } from "../../types/hooks/index.js";
import type { TapeEntry, TapePlanEntry } from "../../types/tape/entry.js";

export class StartupAdvisor {
  async suggestStartup(tape: TapeLike): Promise<string> {
    const goals = new Set<string>();

    for (const entry of tape.replay()) {
      const e = entry as TapeEntry;
      if (e.kind === "plan") {
        const planEntry = e as TapePlanEntry;
        const goal = planEntry.plan.goal.trim();
        if (goal) goals.add(goal);
      }
      if (e.kind === "turn") {
        const prompt = e.turn.prompt?.trim() ?? "";
        if (prompt) goals.add(prompt);
      }
    }

    const goalList = Array.from(goals).slice(-10);

    const lines: string[] = [
      "#!/bin/sh",
      "# Auto-generated startup.sh suggestions",
      "# Review before enabling in gateway mode.",
      "",
      `cd "$(dirname "$0")" || exit 1`,
      "",
    ];

    if (goalList.length > 0) {
      lines.push("# Recurring goals observed in recent sessions:");
      for (const goal of goalList) {
        lines.push(`# - ${goal.replace(/\n/g, " ")}`);
      }
      lines.push("");
    }

    lines.push("# Example: warm up commonly used skills by replaying one summary turn");
    lines.push("# phus run --once --prompt 'Summarize recent work'");
    lines.push("");

    lines.push("# Add cron-style scheduled tasks below (gateway mode runs this script at boot):");
    lines.push("# (crontab -l 2>/dev/null; echo '0 9 * * * phus run --once --prompt \"Daily standup summary\"') | crontab -");
    lines.push("");

    return lines.join("\n");
  }
}
