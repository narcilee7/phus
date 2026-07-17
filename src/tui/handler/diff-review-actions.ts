// src/tui/handler/diff-review-actions.ts
// Bound handler for diff-review actions (accept / reject / edit).
// `reject` writes the original snapshot back; `edit` copies the proposed
// new content into the chat input; `accept` is a no-op (the file is
// already on disk) — we just confirm via a system message.

import { useCallback } from "react";
import { writeFile } from "node:fs/promises";
import type { AppAction } from "@/tui/state/state.js";
import type { DiffReviewAction } from "@/tui/components/diff-components/DiffReviewContext.js";

export function useDiffReviewHandler(
  dispatch: (action: AppAction) => void,
  setInput: (updater: (prev: string) => string) => void,
) {
  return useCallback(
    async (action: DiffReviewAction) => {
      if (action.type === "accept") {
        dispatch({ type: "add_system", text: `✓ accepted changes to ${action.path}`, level: "info" });
        return;
      }
      if (action.type === "reject") {
        // New files have no `oldContent` — refusing to write avoids
        // persisting the literal string "undefined".
        if (typeof action.oldContent !== "string") {
          dispatch({
            type: "add_system",
            text: `cannot revert ${action.path}: no previous content recorded`,
            level: "warn",
          });
          return;
        }
        try {
          await writeFile(action.path, action.oldContent);
          dispatch({ type: "add_system", text: `✓ reverted ${action.path}`, level: "info" });
        } catch (err) {
          dispatch({
            type: "add_system",
            text: `revert failed: ${err instanceof Error ? err.message : String(err)}`,
            level: "error",
          });
        }
        return;
      }
      // action.type === "edit"
      setInput((prev) => prev + action.newContent);
      dispatch({ type: "add_system", text: `✓ copied ${action.path} to input`, level: "info" });
    },
    [dispatch, setInput],
  );
}
