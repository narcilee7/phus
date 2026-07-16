// src/tui/components/ChatViewport.tsx
// Scrollable chat history. Anchors content to the bottom so the latest
// messages are always visible, and clips overflow so long items never spill
// over the input box.

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { ChatItemView, type FileSnapshot } from "@/tui/components/ChatItemView.js";
import { Spinner } from "@/tui/components/Spinner.js";

export interface ChatViewportProps {
  items: ChatItem[];
  busy: boolean;
  scrollOffset: number;
  hasNew: boolean;
  lastOp: string;
  fileSnapshots?: Map<string, FileSnapshot>;
  /** Optional explicit height. When omitted, the viewport computes its own
   *  height from the terminal size. */
  height?: number | string;
}

/** Rows reserved for header, input box, status bar and borders. */
const RESERVED_ROWS = 10;

export function ChatViewport({
  items,
  busy,
  scrollOffset,
  hasNew,
  lastOp,
  fileSnapshots,
  height: propHeight,
}: ChatViewportProps) {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows);

  useEffect(() => {
    const handleResize = () => setRows(stdout.rows);
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  const height = propHeight ?? Math.max(8, rows - RESERVED_ROWS);
  // Clamp the scroll offset so we never scroll past the oldest item.
  const effectiveOffset = Math.max(0, Math.min(scrollOffset, items.length));
  // Items are rendered in normal order but anchored to the bottom via
  // justifyContent="flex-end". The newest items sit at the bottom; older
  // items are clipped at the top when the total content exceeds the
  // viewport height. Scrolling up simply drops the newest N items.
  const visible = items.slice(0, Math.max(0, items.length - effectiveOffset));

  return (
    <Box
      flexDirection="column"
      justifyContent="flex-end"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      height={height}
      width="100%"
      overflow="hidden"
    >
      {visible.map((it) => (
        <ChatItemView key={it.id} item={it} items={items} fileSnapshots={fileSnapshots} />
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
