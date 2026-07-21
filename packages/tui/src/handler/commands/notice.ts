// src/tui/handler/commands/notice.ts
// Tiny helpers shared by every command file: error formatting and the
// system-message shortcut. Keeps the cluster code visually clean.

import type { CommandDispatch } from "./context.js";
import type { SystemLevel } from "../../state/state.js";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function notify(
  dispatch: CommandDispatch,
  text: string,
  level: SystemLevel = "info",
): void {
  dispatch({ type: "add_system", text, level });
}
