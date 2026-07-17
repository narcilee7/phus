// src/tui/components/ToolPill.tsx
// Compact status pill for a tool call: running / success / error.

import React from "react";
import { Box, Text } from "ink";

export type ToolStatus = "running" | "success" | "error";

export interface ToolPillProps {
  name: string;
  status: ToolStatus;
  durationMs?: number;
}

export function ToolPill({ name, status, durationMs }: ToolPillProps) {
  const icon = status === "running" ? "▶" : status === "success" ? "✓" : "✗";
  const color = status === "running" ? "yellow" : status === "success" ? "green" : "red";
  const suffix = status === "running"
    ? "running…"
    : status === "error"
      ? "error"
      : durationMs !== undefined
        ? `${durationMs}ms`
        : "ok";

  return (
    <Box marginRight={1}>
      <Text>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>{name}</Text>
        <Text dimColor> · {suffix}</Text>
      </Text>
    </Box>
  );
}
