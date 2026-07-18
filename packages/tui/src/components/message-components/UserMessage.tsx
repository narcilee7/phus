// src/tui/components/UserMessage.tsx
// User message card.

import React from "react";
import { Box, Text } from "ink";

export function UserMessage({ text }: { text?: string }) {
  return (
    <Box marginY={1} width="100%">
      <Text>
        <Text color="green">❯ </Text>
        <Text color="green" bold>
          {text}
        </Text>
      </Text>
    </Box>
  );
}
