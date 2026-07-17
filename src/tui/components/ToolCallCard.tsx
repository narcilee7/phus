// src/tui/components/ToolCallCard.tsx
// Inline tool-call lifecycle card: running → success/error with expandable
// result summary and inline diff review for file_write.

import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { truncate } from "@/tui/state.js";
import { ToolPill } from "@/tui/components/ToolPill.js";
import { DiffReview } from "@/tui/components/DiffReview.js";
import { TuiFocusContext } from "@/tui/components/TuiFocusContext.js";
import type { FileSnapshot } from "@/tui/components/ToolResultCard.js";

export type { FileSnapshot };

const MAX_RESULT_CHARS = 200;

function summarizeArgs(toolName: string | undefined, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return String(obj.command ?? "").slice(0, 80);
    case "file_write":
      return String(obj.path ?? "").slice(0, 80);
    case "memory_write": {
      const action = (obj.action as { section?: string } | undefined)?.section;
      return action ? String(action).slice(0, 80) : "";
    }
    default:
      return Object.entries(obj)
        .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
        .join(", ")
        .slice(0, 80);
  }
}

function summarizeResult(toolName: string | undefined, result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.stdout === "string" && obj.stdout.length > 0) return obj.stdout;
    if (typeof obj.stderr === "string" && obj.stderr.length > 0) return obj.stderr;
    if (typeof obj.content === "string") return obj.content;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

export interface ToolCallCardProps {
  item: ChatItem;
  fileSnapshots?: Map<string, FileSnapshot>;
  /** Optional stable id, useful in tests. Falls back to React.useId(). */
  id?: string;
}

export function ToolCallCard({ item, fileSnapshots, id: idProp }: ToolCallCardProps) {
  const generatedId = React.useId();
  const id = idProp ?? generatedId;
  const [expanded, setExpanded] = React.useState(false);
  const focusCtx = React.useContext(TuiFocusContext);
  const { isFocused } = useFocus({ isActive: true, id, autoFocus: false });

  React.useEffect(() => {
    if (!focusCtx) return;
    if (isFocused) {
      focusCtx.setFocused(id, "toolcall");
    } else if (focusCtx.focusedId === id) {
      focusCtx.setFocused(null);
    }
  }, [isFocused, id, focusCtx]);

  const active = focusCtx?.focusedId === id;

  useInput((input, key) => {
    if (!active) return;
    if (key.return || input === " ") {
      setExpanded((e) => !e);
    }
  });

  const status = item.isError === undefined ? "running" : item.isError ? "error" : "success";
  const argsSummary = summarizeArgs(item.toolName, item.args);
  const resultText = summarizeResult(item.toolName, item.result);
  const hasResult = item.result !== undefined;
  const isFileWrite = item.toolName === "file_write";
  const snapshot = isFileWrite ? fileSnapshots?.get(item.toolCallId || "") : undefined;
  const newContent =
    isFileWrite && item.args && typeof item.args === "object" && "content" in item.args
      ? String((item.args as Record<string, unknown>).content)
      : undefined;

  const borderColor = status === "error" ? "red" : status === "success" ? "green" : "gray";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={active ? "cyan" : borderColor}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Box flexDirection="row" flexWrap="wrap">
          <ToolPill name={item.toolName || "?"} status={status} />
          {argsSummary && (
            <Box marginLeft={1}>
              <Text dimColor wrap="wrap">
                {argsSummary}
              </Text>
            </Box>
          )}
        </Box>
        {item.durationMs !== undefined && (
          <Box marginLeft={1}>
            <Text dimColor>{item.durationMs}ms</Text>
          </Box>
        )}
      </Box>
      {hasResult && !isFileWrite && resultText.length > 0 && (
        <Box marginTop={1} flexDirection="column" width="100%">
          <Text dimColor wrap="wrap">
            {expanded ? resultText : truncate(resultText, MAX_RESULT_CHARS)}
          </Text>
          {resultText.length > MAX_RESULT_CHARS && (
            <Box marginTop={1}>
              <Text dimColor>{expanded ? "Enter/Space collapse" : "… Enter/Space expand"}</Text>
            </Box>
          )}
        </Box>
      )}
      {isFileWrite && snapshot && newContent !== undefined && (
        <Box marginTop={1} width="100%">
          <DiffReview path={snapshot.path} oldContent={snapshot.content} newContent={newContent} />
        </Box>
      )}
    </Box>
  );
}
