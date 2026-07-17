// src/tui/components/ToolResultCard.tsx
// Tool result card: summary, expandable output, and file-write diff view.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ChatItem } from "@/tui/state/state.js";
import { truncate } from "@/tui/state/state.js";
import { Markdown } from "@/tui/components/rich-text-components/Markdown.js";
import { ToolPill } from "@/tui/components/tool-components/ToolPill.js";
import { DiffReview } from "@/tui/components/diff-components/DiffReview.js";
import { formatToolResult } from "@/tui/components/tool-components/format-result.js";

export interface FileSnapshot {
  path: string;
  content: string;
}

const MAX_TOOL_LINES = 6;
const MAX_TOOL_CHARS = 320;

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|```|\*\s|-\s|\|\s*[-:]+\s*\|)/.test(text);
}

function truncateLines(text: string, maxLines: number, maxChars: number): string {
  const trimmed = truncate(text, maxChars);
  const lines = trimmed.split("\n");
  if (lines.length <= maxLines) return trimmed;
  return lines.slice(0, maxLines).join("\n") + "\n…";
}

function ExpandableResult({ result }: { result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  useInput((input, key) => {
    if (key.return || input === " ") {
      setExpanded((e) => !e);
    }
  });

  const raw = formatToolResult(result);
  const renderMarkdown = typeof result === "string" && looksLikeMarkdown(result);
  const body = renderMarkdown
    ? raw
    : truncateLines(raw, expanded ? 10_000 : MAX_TOOL_LINES, expanded ? 10_000_000 : MAX_TOOL_CHARS);

  return (
    <Box flexDirection="column" width="100%">
      {renderMarkdown ? (
        <Markdown content={body} />
      ) : (
        <Text dimColor wrap="wrap">
          {body}
          {!expanded && raw.length > MAX_TOOL_CHARS ? "\n… Enter/Space to expand" : ""}
        </Text>
      )}
    </Box>
  );
}

export interface ToolResultCardProps {
  item: ChatItem;
  items?: ChatItem[];
  fileSnapshots?: Map<string, FileSnapshot>;
}

export function ToolResultCard({ item, items, fileSnapshots }: ToolResultCardProps) {
  const status = item.isError ? "error" : "success";
  const isFileWrite = item.toolName === "file_write";
  const snapshot = isFileWrite ? fileSnapshots?.get(item.toolCallId || "") : undefined;
  const callItem = items?.find(
    (it) => it.kind === "tool_call" && it.toolCallId === item.toolCallId,
  );
  const newContent =
    isFileWrite && callItem?.args && typeof callItem.args === "object" && "content" in callItem.args
      ? String((callItem.args as Record<string, unknown>).content)
      : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={item.isError ? "red" : "gray"}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      <ToolPill name={item.toolName || "?"} status={status} durationMs={item.durationMs} />
      {isFileWrite && snapshot && newContent !== undefined ? (
        <Box marginTop={1}>
          <DiffReview path={snapshot.path} oldContent={snapshot.content} newContent={newContent} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <ExpandableResult result={item.result} />
        </Box>
      )}
    </Box>
  );
}
