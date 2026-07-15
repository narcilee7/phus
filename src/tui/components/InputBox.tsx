// src/tui/components/InputBox.tsx
// Prompt input with busy indicator and contextual placeholder.

import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function InputBox({
  value,
  busy,
  showHint,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  showHint: boolean;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan">{busy ? "· " : "❯ "}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={showHint ? "type a message, or /help for commands" : ""}
      />
    </Box>
  );
}