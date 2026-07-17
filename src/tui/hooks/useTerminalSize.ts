// src/tui/hooks/useTerminalSize.ts
// Tracks stdout dimensions across resizes. Returns `{ rows }`; add
// `columns` here when a consumer needs it.

import { useEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  rows: number;
}

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows);

  useEffect(() => {
    const handleResize = () => setRows(stdout.rows);
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return { rows };
}
