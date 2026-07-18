// src/tui/components/SubagentCard.tsx
// Inline card rendered in chat when a plan step delegates to a subagent.
// Shows the subagent's goal, status, progress and a session id link.

import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { TuiFocusContext } from "@/context/tui-focus-context.js";
import type { PlanSubagentState } from "@/state/state.js";

const STATUS_ICON: Record<PlanSubagentState["status"], string> = {
  running: "◐",
  completed: "✓",
  failed: "✗",
};

const STATUS_COLOR: Record<PlanSubagentState["status"], string> = {
  running: "cyan",
  completed: "green",
  failed: "red",
};

export interface SubagentCardProps {
  subagent: PlanSubagentState;
  /** Optional callback when the user opens the subagent session. */
  onOpen?: (sessionId: string) => void;
  /** Stable id used for focus tracking; defaults to sessionId. */
  id?: string;
}

export function SubagentCard({ subagent, onOpen, id }: SubagentCardProps) {
  const generatedId = React.useId();
  const stableId = id ?? generatedId;
  const focusCtx = React.useContext(TuiFocusContext);
  const { isFocused } = useFocus({ isActive: true, id: stableId, autoFocus: false });

  React.useEffect(() => {
    if (!focusCtx) return;
    if (isFocused) {
      focusCtx.setFocused(stableId, "toolcall");
    } else if (focusCtx.focusedId === stableId) {
      focusCtx.setFocused(null);
    }
  }, [isFocused, stableId, focusCtx]);

  const active = focusCtx?.focusedId === stableId;

  useInput((input, key) => {
    if (!active) return;
    if ((key.return || input === " ") && onOpen) {
      onOpen(subagent.sessionId);
    }
  });

  const color = STATUS_COLOR[subagent.status];
  const icon = STATUS_ICON[subagent.status];
  const shortId = subagent.sessionId.slice(0, 8);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={active ? "cyan" : color}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={color}>{icon} </Text>
          <Text bold color={color}>
            subagent · {subagent.label || "explore"}
          </Text>
        </Box>
        <Text dimColor>@{shortId}</Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap">{subagent.goal}</Text>
      </Box>
      {subagent.progress && (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            … {subagent.progress}
          </Text>
        </Box>
      )}
      {active && onOpen && (
        <Box marginTop={1}>
          <Text dimColor>Enter open · Esc input</Text>
        </Box>
      )}
    </Box>
  );
}
