// src/tui/components/ChatItemView.tsx
// Dispatch one ChatItem to the appropriate card component.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { UserMessage } from "@/tui/components/UserMessage.js";
import { AssistantMessage } from "@/tui/components/AssistantMessage.js";
import { ToolCallCard } from "@/tui/components/ToolCallCard.js";
import { ToolResultCard, type FileSnapshot } from "@/tui/components/ToolResultCard.js";

export type { FileSnapshot };

export interface ChatItemViewProps {
  item: ChatItem;
  items?: ChatItem[];
  fileSnapshots?: Map<string, FileSnapshot>;
}

export function ChatItemView({ item, items, fileSnapshots }: ChatItemViewProps) {
  switch (item.kind) {
    case "user":
      return <UserMessage text={item.text} />;

    case "assistant":
      return <AssistantMessage item={item} />;

    case "tool_call":
      return <ToolCallCard item={item} fileSnapshots={fileSnapshots} />;

    case "tool_result":
      return <ToolResultCard item={item} items={items} fileSnapshots={fileSnapshots} />;

    case "system": {
      if (!item.text || item.text.trim().length === 0) return null;
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
}
