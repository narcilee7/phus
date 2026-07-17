// src/tui/hooks/useTerminalSize.ts
// Tracks stdout dimensions across resizes. Returns `{ rows }`; add
// `columns` here when a consumer needs it.
//
// macOS / iTerm2 quirk: while the IME candidate window is up, iTerm2
// reports a smaller stdout.rows (the candidate window sits over the
// terminal). If we naively let the chat viewport shrink on that
// "resize", the input box jumps up and the IME candidate highlight
// ends up disconnected from the actual input cursor — visually
// jarring.
//
// Instead, we only ever GROW the layout: we track the largest
// stdout.rows seen this session and ignore any reported size below
// it. The TUI occupies the largest size it has seen; blank rows below
// the TUI (when the IME is up) are the IME candidate window's
// territory, outside the TUI's layout entirely. This keeps the input
// box anchored to its absolute bottom position and the IME candidate
// highlight rendered right next to where the user is typing.

import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  rows: number;
}

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows);
  // Largest stdout.rows we've ever observed. Once we've grown to fit
  // a real terminal size, we never shrink below it — iTerm2's IME
  // candidate window reports a smaller stdout.rows while it's up, and
  // we want to ignore that shrink.
  const maxRowsRef = useRef(stdout.rows);

  useEffect(() => {
    const handleResize = () => {
      const reported = stdout.rows;
      if (reported > maxRowsRef.current) {
        // Real terminal growth (user resized the window bigger).
        maxRowsRef.current = reported;
        setRows(reported);
      }
      // Else: reported ≤ maxRowsRef — this is either noise or iTerm2
      // shrinking stdout.rows because the IME candidate window is
      // open. Either way, keep the layout pinned at its largest size.
    };
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return { rows };
}
