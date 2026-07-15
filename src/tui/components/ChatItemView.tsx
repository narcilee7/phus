// src/tui/components/ChatItemView.tsx
// Render one ChatItem.

import React from "react";
import { Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { truncate } from "@/tui/state.js";

export function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Text>
          <Text color="green">❯ </Text>
          <Text color="green">{item.text}</Text>
        </Text>
      );

    case "assistant":
      return (
        <Text wrap="wrap">
          <Text color="cyan">⛰  </Text>
          {item.text}
          {item.isStreaming && <Text color="cyan">▍</Text>}
        </Text>
      );

    case "tool_call": {
      const args = truncate(JSON.stringify(item.args ?? {}), 60);
      return (
        <Text wrap="wrap">
          <Text color="yellow">⏵ </Text>
          <Text color="yellow">{item.toolName}</Text>
          <Text dimColor> {args}</Text>
          {item.isError === undefined && <Text dimColor>  (running…)</Text>}
        </Text>
      );
    }

    case "tool_result":
      return (
        <Text wrap="wrap">
          <Text>  </Text>
          {item.isError ? <Text color="red">✗ error</Text> : <Text color="green">✓ ok</Text>}
          {item.durationMs !== undefined && <Text dimColor>  {item.durationMs}ms</Text>}
          <Text dimColor>  {truncate(JSON.stringify(item.result ?? ""), 80)}</Text>
        </Text>
      );

    case "system":
      return (
        <Text wrap="wrap">
          <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : "gray"}>
            {item.level === "error" ? "⚠ " : "· "}
            {item.text}
          </Text>
        </Text>
      );
  }
}