// src/tui/layout-context.tsx
// Layout coordination for bottom overlays (suggestion dropdowns, mentions)
// that need to reserve rows in the TUI so they don't overlap other UI.

import React, { createContext, useContext, useState, useCallback } from "react";

interface TuiLayoutContextValue {
  /** Rows currently needed by bottom overlays (suggestions, mentions). */
  bottomOverlayRows: number;
  /** Update the reserved overlay row count. Components like MultiLineInput
   *  call this when their dropdown opens/closes/resizes. */
  setBottomOverlayRows: (rows: number) => void;
}

const TuiLayoutContext = createContext<TuiLayoutContextValue>({
  bottomOverlayRows: 0,
  setBottomOverlayRows: () => {},
});

export function TuiLayoutProvider({ children }: { children: React.ReactNode }) {
  const [bottomOverlayRows, setBottomOverlayRows] = useState(0);
  return (
    <TuiLayoutContext.Provider value={{ bottomOverlayRows, setBottomOverlayRows }}>
      {children}
    </TuiLayoutContext.Provider>
  );
}

export function useTuiLayout() {
  return useContext(TuiLayoutContext);
}

/** Hook for components that need to reserve a dynamic number of rows.
 *  Returns a setter that should be called whenever the overlay size changes. */
export function useBottomOverlay(rows: number, active: boolean) {
  const { setBottomOverlayRows } = useTuiLayout();
  React.useEffect(() => {
    setBottomOverlayRows(active ? rows : 0);
    return () => setBottomOverlayRows(0);
  }, [active, rows, setBottomOverlayRows]);
}
