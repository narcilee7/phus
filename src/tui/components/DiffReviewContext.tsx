// src/tui/components/DiffReviewContext.tsx
// Context that wires file-write diff review actions to the application and
// tracks which review card currently has keyboard focus.

import { createContext, useContext } from "react";

export type DiffReviewAction =
  | { type: "accept"; path: string }
  | { type: "reject"; path: string; oldContent: string }
  | { type: "edit"; path: string; newContent: string };

interface DiffReviewContextValue {
  onAction: (action: DiffReviewAction) => void;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

export const DiffReviewContext = createContext<DiffReviewContextValue | undefined>(undefined);

export function useDiffReview() {
  return useContext(DiffReviewContext);
}
