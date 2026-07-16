// src/tui/components/PermissionBar.tsx
// Inline permission request shown above the input box. Does not block the
// rest of the UI — only steals input while it is active.

import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest, RememberChoice } from "@/tui/state.js";

export function PermissionBar({
  request,
  onResolve,
}: {
  request: PermissionRequest;
  onResolve: (allow: boolean, remember: RememberChoice) => void;
}) {
  useInput((input, key) => {
    if (key.escape) {
      onResolve(false, "once");
      return;
    }
    if (key.return) {
      onResolve(true, "once");
      return;
    }
    const ch = input.toLowerCase();
    if (ch === "y") {
      onResolve(true, "once");
    } else if (ch === "s") {
      onResolve(true, "session");
    } else if (ch === "a") {
      onResolve(true, "always");
    } else if (ch === "n") {
      onResolve(false, "once");
    }
  });

  const summary = formatArgs(request.args);

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
      justifyContent="space-between"
    >
      <Box flexDirection="column" flexGrow={1}>
        <Text>
          <Text color="yellow">⚠ </Text>
          Allow <Text bold color="yellow">{request.toolName}</Text>?
        </Text>
        {summary && (
          <Text dimColor wrap="wrap">
            {summary}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text>
          <Text color="green">[Y]es</Text>
          <Text> · </Text>
          <Text color="cyan">[S]ession</Text>
        </Text>
        <Text>
          <Text color="blue">[A]lways</Text>
          <Text> · </Text>
          <Text color="red">[N]o</Text>
        </Text>
      </Box>
    </Box>
  );
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "(no args)";
  if (typeof args === "string") return args;
  try {
    const json = JSON.stringify(args, null, 2);
    // Keep the summary compact so it fits on one or two lines.
    return json.length > 160 ? json.slice(0, 160) + "…" : json;
  } catch {
    return String(args);
  }
}
