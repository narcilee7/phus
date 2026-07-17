// src/tui/components/TodoPill.tsx
// Small status pill above the input box. Shows what the agent is doing
// right now: running tools, thinking, or idle.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state/state.js";
import { Spinner } from "@/tui/components/app-common-components/Spinner.js";
import { ToolPill } from "@/tui/components/tool-components/ToolPill.js";

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

  return (
    <Box paddingX={1} flexDirection="row" flexWrap="wrap">
      <Spinner />
      {running.length > 0 ? (
        <Box marginLeft={1} flexDirection="row" flexWrap="wrap">
          {running.map((it) => (
            <ToolPill key={it.id} name={it.toolName || "?"} status="running" />
          ))}
        </Box>
      ) : (
        <Box marginLeft={1}>
          <Text color="cyan" dimColor={!busy}>
            {lastOp || "thinking…"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
