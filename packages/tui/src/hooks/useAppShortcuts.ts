// src/tui/hooks/useAppShortcuts.ts
// Centralized Ctrl / sidebar / scroll handling. Lives in one place so
// shortcut conflicts (palette vs sidebar vs permission bar) are obvious
// at a glance.

import { useRef } from "react";
import { useInput } from "ink";
import type { AppAction, AppState } from "@/state/state.js";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { runSlash } from "@/handler/commands/commands.js";

export interface ShortcutsDeps {
  agent: PhusAgent;
  state: AppState;
  dispatch: (action: AppAction) => void;
  /** Resolved Ink `useApp().exit()`. */
  exit: () => void;
  /** Whether the command palette overlay is open. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Whether the file/session sidebar is open. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** True if a code block / diff review / tool card currently owns the keys. */
  interactiveFocused: boolean;
  clearInteractiveFocus: () => void;
  /** Effective chat viewport height (controls PgUp/PgDn step size).
   *  Read from a ref so the hook doesn't re-bind every render. */
  chatHeightRef: { current: number };
  /** Toggle the plan panel expanded/collapsed view. */
  togglePlanExpanded: () => void;
}

export function useAppShortcuts({
  agent,
  state,
  dispatch,
  exit,
  paletteOpen,
  setPaletteOpen,
  sidebarOpen,
  setSidebarOpen,
  interactiveFocused,
  clearInteractiveFocus,
  chatHeightRef,
  togglePlanExpanded,
}: ShortcutsDeps): void {
  // Mirror state into a ref so the input handler can read the latest
  // values without forcing a re-subscription every time state changes.
  const stateRef = useRef(state);
  stateRef.current = state;

  useInput((input, key) => {
    if (paletteOpen) return;
    if (key.ctrl && input === "b" && stateRef.current.permissionQueue.length === 0) {
      setSidebarOpen(!sidebarOpen);
      return;
    }
    if (sidebarOpen) return;
    if (interactiveFocused && key.escape) {
      clearInteractiveFocus();
      return;
    }
    // When an interactive card owns the keys, swallow printable input
    // so chat input never leaks in (e.g. accidentally typing "copy"
    // while focused on a code block).
    if (interactiveFocused && !key.ctrl && !key.meta) return;
    if ((key.ctrl || key.meta) && input === "k" && stateRef.current.permissionQueue.length === 0) {
      setPaletteOpen(true);
      return;
    }
    if (key.ctrl && input === "c") {
      if (stateRef.current.busy) {
        agent.abort();
        dispatch({ type: "set_busy", busy: false });
        dispatch({ type: "set_last_op", op: "idle" });
        dispatch({ type: "add_system", text: "✓ aborted by user", level: "warn" });
      } else {
        exit();
      }
      return;
    }
    if (key.ctrl && input === "l") {
      dispatch({ type: "clear_items" });
      return;
    }
    if (key.ctrl && input === "z" && !stateRef.current.busy) {
      void runSlash("/undo", agent, stateRef.current, dispatch);
      return;
    }
    if (key.ctrl && input === "t" && stateRef.current.plan) {
      togglePlanExpanded();
      return;
    }
    if (key.pageUp) {
      dispatch({ type: "scroll_up", lines: Math.max(1, chatHeightRef.current - 1) });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: "scroll_down", lines: Math.max(1, chatHeightRef.current - 1) });
      return;
    }
    if (key.ctrl && key.upArrow) {
      dispatch({ type: "scroll_up", lines: 1 });
      return;
    }
    if (key.ctrl && key.downArrow) {
      dispatch({ type: "scroll_down", lines: 1 });
      return;
    }
    if (key.ctrl && key.end) {
      dispatch({ type: "scroll_bottom" });
    }
  });
}
