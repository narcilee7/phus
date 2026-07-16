// src/tui/components/ChatItemView.tsx
// Render one ChatItem. Tool calls/results are rendered as compact cards
// so the chat log is scannable even with heavy JSON payloads.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { truncate } from "@/tui/state.js";

const MAX_TOOL_LINES = 6;
const MAX_TOOL_CHARS = 320;

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateLines(text: string, maxLines: number, maxChars: number): string {
  const trimmed = truncate(text, maxChars);
  const lines = trimmed.split("\n");
  if (lines.length <= maxLines) return trimmed;
  return lines.slice(0, maxLines).join("\n") + "\n…";
}

export function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginY={1}>
          <Text>
            <Text color="green">❯ </Text>
            <Text color="green" bold>
              {item.text}
            </Text>
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginY={1}>
          <Text wrap="wrap">
            <Text color="cyan">⛰ </Text>
            {item.text}
            {item.isStreaming && <Text color="cyan">▍</Text>}
          </Text>
        </Box>
      );

    case "tool_call": {
      const body = truncateLines(formatValue(item.args), MAX_TOOL_LINES, MAX_TOOL_CHARS);
      const isRunning = item.isError === undefined;
      return (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={isRunning ? "yellow" : "gray"}
          paddingX={1}
          marginY={1}
        >
          <Text>
            <Text color="yellow">▶ </Text>
            <Text bold color="yellow">
              {item.toolName}
            </Text>
            {isRunning && (
              <Text dimColor> · running…</Text>
            )}
          </Text>
          <Text dimColor wrap="wrap">
            {body}
          </Text>
        </Box>
      );
    }

    case "tool_result": {
      const body = truncateLines(formatValue(item.result), MAX_TOOL_LINES, MAX_TOOL_CHARS);
      const ok = !item.isError;
      return (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={ok ? "green" : "red"}
          paddingX={1}
          marginY={1}
        >
          <Text>
            {ok ? (
              <Text color="green">✓ </Text>
            ) : (
              <Text color="red">✗ </Text>
            )}
            <Text bold color={ok ? "green" : "red"}>
              {item.toolName}
            </Text>
            <Text dimColor>
              {ok ? " · ok" : " · error"}
              {item.durationMs !== undefined ? ` · ${item.durationMs}ms` : ""}
            </Text>
          </Text>
          <Text dimColor wrap="wrap">
            {body}
          </Text>
        </Box>
      );
    }

    case "system":
      return (
        <Box marginY={1}>
          <Text wrap="wrap">
            <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : "gray"}>
              {item.level === "error" ? "⚠ " : "· "}
              {item.text}
            </Text>
          </Text>
        </Box>
      );
  }
}
