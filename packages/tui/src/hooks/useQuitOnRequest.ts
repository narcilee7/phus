// src/tui/hooks/useQuitOnRequest.ts
// Bridge a state-flag-driven exit request to ink's `useApp().exit()`.
// Calling exit() from inside an async chain (e.g. the slash-command
// dispatch that runs after a useInput handler has already returned) is
// unreliable — the render loop may not flush its cleanup before the
// process is asked to exit. The robust path is:
//   1. Submit dispatches `request_quit`.
//   2. Reducer sets `quitRequested = true`.
//   3. This useEffect watches that flag during the next commit and
//      calls exit() synchronously, when ink is ready to react.

import { useEffect } from "react";
import type { AppState } from "@/state/state.js";

export function useQuitOnRequest(
  quitRequested: AppState["quitRequested"],
  dispatch: (action: { type: "consume_quit_request" }) => void,
  exit: () => void,
): void {
  useEffect(() => {
    if (!quitRequested) return;
    dispatch({ type: "consume_quit_request" });
    // ink's useApp().exit() is unreliable when called outside the
    // synchronous input handler (e.g. from inside an async submit
    // chain). Two paths to leave the process:
    //   1. exit() — graceful, asks ink to unmount. May not flush
    //      if it's invoked from a useEffect whose render loop is
    //      already winding down.
    //   2. process.exit(0) — guaranteed termination. We schedule it
    //      via setImmediate so the dispatch above commits first and
    //      log streams flush.
    exit();
    setImmediate(() => process.exit(0));
  }, [quitRequested, dispatch, exit]);
}
