// src/tui/components/TuiFocusContext.tsx
// Single source of truth for which interactive TUI card (code block,
// diff review, tool call card, etc.) currently holds keyboard focus.

import { createContext, useContext } from "react";

export type FocusKind = "codeblock" | "diffreview" | "toolcall" | "subagent";

interface TuiFocusContextValue {
  focusedId: string | null;
  focusedKind: FocusKind | null;
  setFocused: (id: string | null, kind?: FocusKind) => void;
}

export const TuiFocusContext = createContext<TuiFocusContextValue | undefined>(undefined);

export function useTuiFocus() {
  return useContext(TuiFocusContext);
}
