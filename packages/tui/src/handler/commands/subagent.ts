// src/tui/handler/commands/subagent.ts
// Sidebar control for subagent awareness. "show" opens the sessions
// sidebar; "files" switches back to the file tree.

import type { CommandRegistry } from "./context.js";
import { notify } from "./notice.js";

export function registerSubagent(): CommandRegistry {
  return {
    subagent(arg, { dispatch }) {
      const sub = (arg || "show").trim();
      if (sub === "show" || sub === "") {
        dispatch({ type: "request_sidebar", view: "sessions" });
        notify(dispatch, "→ opened subagent sessions in sidebar");
        return;
      }
      if (sub === "files" || sub === "hide") {
        dispatch({ type: "request_sidebar", view: "files" });
        return;
      }
      notify(dispatch, "usage: /subagent [show|files]", "warn");
    },
  };
}
