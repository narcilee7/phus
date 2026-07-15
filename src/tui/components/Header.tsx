// src/tui/components/Header.tsx
// Top status bar: model label, session, tape stats, last op.

import React from "react";
import { Box, Text } from "ink";

export interface HeaderStats {
  entries: number;
  skills: number;
  turns: number;
}

export function Header({
  model,
  session,
  stats,
  lastOp,
}: {
  model: string;
  session: string;
  stats: HeaderStats;
  lastOp: string;
}) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box>
        <Text bold color="cyan">⛰  Phus</Text>
        <Text>  ·  </Text>
        <Text>{model}</Text>
      </Box>
      <Text dimColor>
        session={session} · {stats.skills} skills · {stats.entries} tape entries · {lastOp}
      </Text>
    </Box>
  );
}