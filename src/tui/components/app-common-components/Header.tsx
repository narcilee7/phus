// src/tui/components/Header.tsx
// Top status bar: model label, session, tape stats, last op.

import React from "react";
import { Box, Text } from "ink";

export interface HeaderStats {
  entries: number;
  skills: number;
  turns: number;
  checkpoints: number;
  lastCheckpointAt?: number;
}

function formatCheckpointAge(ts: number | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const checkpointHint = stats.checkpoints > 0
    ? ` · ${stats.checkpoints} checkpoints${stats.lastCheckpointAt ? ` · last ${formatCheckpointAge(stats.lastCheckpointAt)}` : ""}`
    : "";
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Box>
        <Text bold color="cyan">⛰  Phus</Text>
        <Text>  ·  </Text>
        <Text>{model}</Text>
      </Box>
      <Text dimColor>
        session={session} · {stats.skills} skills · {stats.entries} tape entries{checkpointHint} · {lastOp}
      </Text>
    </Box>
  );
}