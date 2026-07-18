// src/tui/components/SessionTree.tsx
// Tree view of the current session and its subagents, shown in the
// sidebar. Keyboard-navigable: ↑↓ to move, Enter to focus the chosen
// session, d to disconnect the subagent from the active plan step.

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PlanState, PlanSubagentState } from "@/state/state.js";

export interface SessionTreeProps {
  /** Current session id (always present). */
  currentSessionId: string;
  /** Active plan's subagents, if any. */
  subagents?: PlanSubagentState[];
  /** Active plan (for showing status in the tree root). */
  plan?: PlanState;
  /** Height in rows for the surrounding sidebar. */
  height: number;
  /** Focus a subagent session (e.g. /use <sessionId>). */
  onFocusSubagent?: (sessionId: string) => void;
  /** Called when the user wants to dismiss this view. */
  onClose: () => void;
}

interface TreeNode {
  id: string;
  label: string;
  detail: string;
  status: "running" | "completed" | "failed" | "idle";
  childIds: string[];
}

function buildNodes(
  currentSessionId: string,
  plan?: PlanState,
  subagents: PlanSubagentState[] = [],
): TreeNode[] {
  const root: TreeNode = {
    id: currentSessionId,
    label: "current",
    detail: currentSessionId,
    status: plan?.status === "paused" ? "idle" : "running",
    childIds: subagents.map((a) => a.sessionId),
  };
  const children: TreeNode[] = subagents.map((a) => ({
    id: a.sessionId,
    label: a.label || "subagent",
    detail: a.goal,
    status: a.status,
    childIds: [],
  }));
  return [root, ...children];
}

function statusColor(status: TreeNode["status"]): string {
  switch (status) {
    case "running":
      return "cyan";
    case "completed":
      return "green";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

function statusGlyph(status: TreeNode["status"]): string {
  switch (status) {
    case "running":
      return "◐";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    default:
      return "○";
  }
}

export function SessionTree({
  currentSessionId,
  subagents,
  plan,
  height,
  onFocusSubagent,
  onClose,
}: SessionTreeProps) {
  const nodes = buildNodes(currentSessionId, plan, subagents);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, nodes.length - 1)));
  }, [nodes.length]);

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(nodes.length - 1, s + 1));
    if ((key.return || input === " ") && nodes[selected] && onFocusSubagent) {
      onFocusSubagent(nodes[selected]!.id);
    }
    if (key.escape || input === "q") onClose();
  });

  const maxVisible = Math.max(3, height - 4);
  const start = Math.max(0, Math.min(selected - 1, nodes.length - maxVisible));
  const visible = nodes.slice(start, start + maxVisible);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      height={height}
    >
      <Box justifyContent="space-between">
        <Text bold>Sessions</Text>
        <Text dimColor>q close</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {visible.map((node, idx) => {
          const actualIdx = start + idx;
          const isSelected = actualIdx === selected;
          const indent = node.id === currentSessionId ? 0 : 2;
          const prefix = node.id === currentSessionId ? "▾ " : "└─ ";
          return (
            <Box key={node.id} flexDirection="column" marginLeft={indent}>
              <Box>
                {isSelected ? (
                  <Text backgroundColor="cyan" color="black">
                    {prefix}
                    {statusGlyph(node.status)} {node.label}
                  </Text>
                ) : (
                  <Text>
                    {prefix}
                    <Text color={statusColor(node.status)}>
                      {statusGlyph(node.status)}
                    </Text>{" "}
                    {node.label}
                  </Text>
                )}
              </Box>
              <Box marginLeft={2}>
                <Text dimColor wrap="truncate-end">
                  {node.detail}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box>
        <Text dimColor>↑↓ navigate · Enter open · q close</Text>
      </Box>
    </Box>
  );
}
