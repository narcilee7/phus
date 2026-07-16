// src/tui/components/ChatViewport.tsx
// Scrollable chat history. Renders a sliding window of ChatItems so the
// TUI stays usable when the conversation grows long.

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { ChatItemView } from "@/tui/components/ChatItemView.js";
import { Spinner } from "@/tui/components/Spinner.js";

export interface ChatViewportProps {
  items: ChatItem[];
  busy: boolean;
  scrollOffset: number;
  hasNew: boolean;
  lastOp: string;
}

/** Rows reserved for header, input box, status bar and borders. */
const RESERVED_ROWS = 10;

export function ChatViewport({ items, busy, scrollOffset, hasNew, lastOp }: ChatViewportProps) {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows);

  useEffect(() => {
    const handleResize = () => setRows(stdout.rows);
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  const height = Math.max(8, rows - RESERVED_ROWS);
  // Treat one item as ~2 rows on average; this is a coarse approximation
  // because terminal wrapping is hard to predict, but it keeps the viewport
  // bounded and scrollable.
  const visibleCount = Math.max(3, Math.floor(height / 2));
  const maxOffset = Math.max(0, items.length - visibleCount);
  const effectiveOffset = Math.min(scrollOffset, maxOffset);
  const end = Math.max(0, items.length - effectiveOffset);
  const start = Math.max(0, end - visibleCount);
  const visible = items.slice(start, end);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      height={height}
    >
      {visible.map((it) => (
        <ChatItemView key={it.id} item={it} />
      ))}
      {busy && (
        <Box>
          <Spinner />
          <Box marginLeft={1}>
            <Text color="cyan">{lastOp || "thinking…"}</Text>
          </Box>
        </Box>
      )}
      {hasNew && effectiveOffset > 0 && (
        <Box marginTop={1}>
          <Text color="yellow" backgroundColor="black">
            ↓ new messages — press End to jump to bottom
          </Text>
        </Box>
      )}
    </Box>
  );
}
