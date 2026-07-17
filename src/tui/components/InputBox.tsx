// src/tui/components/InputBox.tsx
// Prompt input with busy indicator and contextual placeholder.
// Supports multi-line text (Shift+Enter), history (Up/Down), @-mentions
// and attached-file chips.

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { MultiLineInput } from "@/tui/components/MultiLineInput.js";
import { SLASH_COMMANDS } from "@/tui/commands.js";
import { formatFileSize } from "@/tui/mentions.js";
import { scanFiles } from "@/tui/components/CommandPalette.js";

export interface MentionChip {
  path: string;
  size: number;
}

export function InputBox({
  value,
  busy,
  showHint,
  onChange,
  onSubmit,
  isActive = true,
  mentions = [],
}: {
  value: string;
  busy: boolean;
  showHint: boolean;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
  isActive?: boolean;
  mentions?: MentionChip[];
}) {
  const [fileSuggestions, setFileSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const files = await scanFiles(process.cwd(), 3);
      if (!cancelled) setFileSuggestions(files);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      {mentions.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
          {mentions.map((m) => (
            <Box key={m.path} marginRight={1}>
              <Text dimColor>
                📄 {m.path.split("/").pop() ?? m.path} ({m.size > 0 ? formatFileSize(m.size) : "pending"})
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan">{busy ? "· " : "❯ "}</Text>
        <Box flexGrow={1}>
          <MultiLineInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            busy={busy}
            showHint={showHint}
            placeholder={showHint ? "type a message, Shift+Enter for newline, /help for commands, @file" : ""}
            isActive={isActive}
            suggestions={SLASH_COMMANDS}
            mentionSuggestions={fileSuggestions}
          />
        </Box>
      </Box>
    </Box>
  );
}
