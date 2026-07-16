// src/tui/components/InputBox.tsx
// Prompt input with busy indicator and contextual placeholder.
// Supports multi-line text (Shift+Enter) and history (Up/Down).

import React from "react";
import { Box, Text } from "ink";
import { MultiLineInput } from "@/tui/components/MultiLineInput.js";
import { SLASH_COMMANDS } from "@/tui/commands.js";

export function InputBox({
  value,
  busy,
  showHint,
  onChange,
  onSubmit,
  isActive = true,
}: {
  value: string;
  busy: boolean;
  showHint: boolean;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
  isActive?: boolean;
}) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box>
        <Text color="cyan">{busy ? "· " : "❯ "}</Text>
        <Box flexGrow={1}>
          <MultiLineInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            busy={busy}
            showHint={showHint}
            placeholder={showHint ? "type a message, Shift+Enter for newline, /help for commands" : ""}
            isActive={isActive}
            suggestions={SLASH_COMMANDS.map((c) => c.name)}
          />
        </Box>
      </Box>
    </Box>
  );
}
