// src/tui/handler/commands/safety.ts
// Safety and health introspection — policy rules, health check, hard
// abort of an in-flight turn.

import type { CommandRegistry } from "@/tui/handler/commands/context.js";
import { notify } from "@/tui/handler/commands/notice.js";

export function registerSafety(): CommandRegistry {
  return {
    policy(_arg, { agent, dispatch }) {
      const rules = agent.getPolicy();
      notify(
        dispatch,
        `policy rules:\n${rules.map((r) => `  - ${r.toolName}`).join("\n")}\n\n` +
          `file_write roots: ./skills, ./.phus, ./tmp, ./out\n` +
          `bash blocklist: rm -rf /, fork bombs, curl|sh, dd, chmod -R 777, mkfs`,
      );
    },

    async health(_arg, { dispatch }) {
      const { healthCheck } = await import("@/commands/health.js");
      const h = healthCheck();
      notify(dispatch, JSON.stringify(h, null, 2), h.ok ? "info" : "warn");
    },

    interrupt(_arg, { agent, dispatch }) {
      agent.interrupt();
      notify(dispatch, "✓ current turn aborted", "warn");
    },
  };
}
