// src/tui/components/TodoPill.tsx
// Small status pill above the input box. Shows what the agent is doing
// right now: running tools, thinking, or idle.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { Spinner } from "@/tui/components/Spinner.js";

export function TodoPill({
  items,
  busy,
  lastOp,
}: {
  items: ChatItem[];
  busy: boolean;
  lastOp: string;
}) {
  const running = items.filter((it) => it.kind === "tool_call" && it.isError === undefined);

  if (!busy && running.length === 0) {
    return null;
  }

  let label: string;
  if (running.length > 0) {
    const names = running.map((it) => it.toolName).join(", ");
    label = running.length === 1 ? `running: ${names}` : `running ${running.length}: ${names}`;
  } else {
    label = lastOp || "thinking…";
  }

  return (
    <Box paddingX={1}>
      <Spinner />
      <Box marginLeft={1}>
        <Text color="cyan" dimColor={!busy}>
          {label}
        </Text>
      </Box>
    </Box>
  );
}
