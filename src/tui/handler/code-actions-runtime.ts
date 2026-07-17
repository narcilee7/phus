// src/tui/handler/code-actions-runtime.ts
// Bound handler for code-block actions (copy / run / insert). Threads
// state mutations and input edits through dispatch + setInput.

import { useCallback } from "react";
import type { AppAction } from "@/tui/state/state.js";
import type { CodeBlockAction } from "@/tui/components/rich-text-components/CodeActionContext.js";
import { copyToClipboard, runCode } from "@/tui/handler/code/code-actions.js";

export function useCodeActionHandler(
  dispatch: (action: AppAction) => void,
  setInput: (updater: (prev: string) => string) => void,
) {
  return useCallback(
    async (action: CodeBlockAction) => {
      if (action.type === "copy") {
        try {
          await copyToClipboard(action.code);
          dispatch({ type: "add_system", text: "✓ copied to clipboard", level: "info" });
        } catch (err) {
          dispatch({
            type: "add_system",
            text: `copy failed: ${err instanceof Error ? err.message : String(err)}`,
            level: "error",
          });
        }
        return;
      }
      if (action.type === "run") {
        dispatch({ type: "add_system", text: `running ${action.language}…`, level: "info" });
        try {
          const { output, exitCode } = await runCode(action.language, action.code);
          const status = exitCode === 0 ? "✓" : `✗ exit ${exitCode}`;
          dispatch({
            type: "add_system",
            text: `${status} ${action.language}\n${output}`,
            level: exitCode === 0 ? "info" : "warn",
          });
        } catch (err) {
          dispatch({
            type: "add_system",
            text: `run failed: ${err instanceof Error ? err.message : String(err)}`,
            level: "error",
          });
        }
        return;
      }
      // action.type === "insert"
      setInput((prev) => prev + action.code);
      dispatch({ type: "add_system", text: "✓ code inserted into input", level: "info" });
    },
    [dispatch, setInput],
  );
}
