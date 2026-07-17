// src/tui/components/StatusBar.tsx
// Bottom status line: model, skills, tape entries, shortcut hints.

import React from "react";
import { Box, Text } from "ink";

export function StatusBar({
  modelLabel,
  skills,
  entries,
  hint,
}: {
  modelLabel: string;
  skills: number;
  entries: number;
  hint?: string;
}) {
  const defaultHint = "Ctrl+C quit · Ctrl+L clear · PgUp/PgDn scroll";
  return (
    <Box paddingX={1}>
      <Text dimColor>
        {modelLabel} · {skills} skills · {entries} tape entries · {hint ?? defaultHint}
      </Text>
    </Box>
  );
}