// src/tui/components/AssistantMessage.tsx
// Assistant message card with optional reasoning preview.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { truncate } from "@/tui/state.js";
import { Markdown } from "@/tui/components/Markdown.js";

export function AssistantMessage({ item }: { item: ChatItem }) {
  const hasContent =
    (item.text ?? "").trim().length > 0 || (item.reasoning ?? "").length > 0;
  if (!hasContent && !item.isStreaming) return null;

  return (
    <Box flexDirection="column" marginY={1} width="100%">
      <Box>
        <Text color="cyan">⛰ </Text>
        {item.isStreaming && <Text color="cyan">▍</Text>}
      </Box>
      {item.reasoning && (
        <Box width="100%" marginBottom={1}>
          <Text dimColor wrap="wrap">
            <Text color="gray" bold>
              thinking{" "}
            </Text>
            {truncate(item.reasoning, 120)}
          </Text>
        </Box>
      )}
      <Box width="100%">
        <Markdown content={item.text ?? ""} />
      </Box>
    </Box>
  );
}
