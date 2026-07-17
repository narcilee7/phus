// src/tui/hooks/useUndoHint.ts
// Flashes a "Ctrl+Z undo" hint in the status bar for a few seconds after a
// file_write / skill_write / memory_write completes. Lets the user know that
// undo is now available without spamming on every turn.

import { useEffect, useRef, useState } from "react";
import { WRITE_HINT_TTL_MS } from "@/tui/constants.js";
import type { ChatItem } from "@/tui/state/state.js";

const UNDOABLE_TOOLS = new Set(["file_write", "skill_write", "memory_write"]);

/** Returns the timestamp (ms since epoch) of the most recent successful
 *  undoable write — or `undefined` if no hint should be shown right now. */
export function useUndoHint(items: ChatItem[]): number | undefined {
  const [lastWriteTs, setLastWriteTs] = useState<number | undefined>(undefined);
  const prevItemsRef = useRef(items);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const prevMap = new Map(prevItemsRef.current.map((it) => [it.id, it]));
    const newlyCompleted = items.find((it) => {
      if (it.kind !== "tool_call") return false;
      if (!UNDOABLE_TOOLS.has(it.toolName || "")) return false;
      if (it.isError === undefined) return false;
      const prev = prevMap.get(it.id);
      return !prev || prev.isError === undefined;
    });
    prevItemsRef.current = items;
    if (newlyCompleted) {
      setLastWriteTs(Date.now());
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setLastWriteTs(undefined), WRITE_HINT_TTL_MS);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [items]);

  return lastWriteTs;
}
