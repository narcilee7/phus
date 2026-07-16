// src/tui/components/PermissionPrompt.tsx
// Modal-like prompt for tool-use approval. Rendered above the input box
// when the agent is waiting for a human permission decision.

import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest } from "@/tui/state.js";

export function PermissionPrompt({
  request,
  onResolve,
}: {
  request: PermissionRequest;
  onResolve: (allow: boolean, remember: boolean) => void;
}) {
  useInput((input, key) => {
    if (key.return) {
      onResolve(true, false);
      return;
    }
    const ch = input.toLowerCase();
    if (ch === "y") {
      onResolve(true, false);
    } else if (ch === "a") {
      onResolve(true, true);
    } else if (ch === "n") {
      onResolve(false, false);
    }
  });

  const summary = formatArgs(request.args);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Text bold color="yellow">
        ⚠ Permission required
      </Text>
      <Text>
        Allow <Text bold>{request.toolName}</Text>?
      </Text>
      <Text dimColor wrap="wrap">
        {summary}
      </Text>
      <Box marginTop={1}>
        <Text color="green">[Y]es</Text>
        <Text> · </Text>
        <Text color="cyan">[A]lways</Text>
        <Text> · </Text>
        <Text color="red">[N]o</Text>
        <Text dimColor> (Enter = Yes)</Text>
      </Box>
    </Box>
  );
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "(no args)";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
