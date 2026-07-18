// Layout coordination for bottom overlays (suggestion dropdowns, mentions)
// that need to reserve rows in the TUI so they don't overlap other UI.

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

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

export function useBottomOverlay(rows: number, active: boolean) {
  const { setBottomOverlayRows } = useTuiLayout();
  useEffect(() => {
    setBottomOverlayRows(active ? rows : 0);
    return () => setBottomOverlayRows(0);
  }, [active, rows, setBottomOverlayRows])
}
