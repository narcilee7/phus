// src/tui/hooks/useSidebarRequest.ts
// Slash commands (e.g. /subagent) can request a particular sidebar view;
// this hook honors the request once and consumes the flag so it doesn't
// re-trigger on unrelated re-renders.

import { useEffect } from "react";
import type { AppState, AppAction } from "@/tui/state/state.js";

export function useSidebarRequest(
  request: AppState["sidebarRequest"],
  dispatch: (action: AppAction) => void,
  setView: (view: "files" | "sessions") => void,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!request) return;
    setView(request);
    setOpen(true);
    dispatch({ type: "consume_sidebar_request" });
  }, [request, dispatch, setView, setOpen]);
}
