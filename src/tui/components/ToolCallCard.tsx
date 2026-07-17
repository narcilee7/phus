// src/tui/components/ToolCallCard.tsx
// Inline tool-call card shown while a tool is running.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { ToolPill } from "@/tui/components/ToolPill.js";

function summarizeArgs(toolName: string | undefined, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return String(obj.command ?? "").slice(0, 80);
    case "file_write":
      return String(obj.path ?? "").slice(0, 80);
    case "memory_write": {
      const action = (obj.action as { section?: string } | undefined)?.section;
      return action ? String(action).slice(0, 80) : "";
    }
    default:
      return Object.entries(obj)
        .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
        .join(", ")
        .slice(0, 80);
  }
}

export function ToolCallCard({ item }: { item: ChatItem }) {
  const summary = summarizeArgs(item.toolName, item.args);
  return (
    <Box marginY={1} flexDirection="row" flexWrap="wrap" width="100%">
      <ToolPill name={item.toolName || "?"} status="running" />
      {summary && (
        <Box marginLeft={1}>
          <Text dimColor wrap="wrap">
            {summary}
          </Text>
        </Box>
      )}
    </Box>
  );
}
