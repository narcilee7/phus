// src/tui/components/ChatItemView.tsx
// Render one ChatItem. Tool calls are compact pills; tool results show
// summaries, diff views for file writes, and expandable output.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ChatItem } from "@/tui/state.js";
import { truncate } from "@/tui/state.js";
import { Markdown } from "@/tui/components/Markdown.js";
import { ToolPill } from "@/tui/components/ToolPill.js";
import { DiffView } from "@/tui/components/DiffView.js";

const MAX_TOOL_LINES = 6;
const MAX_TOOL_CHARS = 320;

export interface FileSnapshot {
  path: string;
  content: string;
}

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|```|\*\s|-\s|\|\s*[-:]+\s*\|)/.test(text);
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    // Agent tool results: { content: [{ type: "text", text: "..." }] }
    if (Array.isArray(obj.content)) {
      const texts = obj.content
        .map((c) => (typeof c === "object" && c !== null ? (c as Record<string, unknown>).text : undefined))
        .filter((t): t is string => typeof t === "string");
      if (texts.length > 0) return texts.join("");
    }
    // Legacy / plain stdout-shaped results.
    if (typeof obj.stdout === "string") return obj.stdout;
    if (typeof obj.stderr === "string" && obj.stderr.length > 0) return obj.stderr;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

  const raw = formatValue(result);
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
        </Text>
      )}
      {!expanded && raw.length > MAX_TOOL_CHARS && (
        <Box marginTop={1}>
          <Text dimColor>… Enter/Space to expand</Text>
        </Box>
      )}
    </Box>
  );
}

function ToolResultView({
  item,
  items,
  fileSnapshots,
}: {
  item: ChatItem;
  items?: ChatItem[];
  fileSnapshots?: Map<string, FileSnapshot>;
}) {
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
          <DiffView oldText={snapshot.content} newText={newContent} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <ExpandableResult result={item.result} />
        </Box>
      )}
    </Box>
  );
}

export interface ChatItemViewProps {
  item: ChatItem;
  items?: ChatItem[];
  fileSnapshots?: Map<string, FileSnapshot>;
}

export function ChatItemView({ item, items, fileSnapshots }: ChatItemViewProps) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginY={1}>
          <Text>
            <Text color="green">❯ </Text>
            <Text color="green" bold>
              {item.text}
            </Text>
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box flexDirection="column" marginY={1} width="100%">
          <Box>
            <Text color="cyan">⛰ </Text>
            {item.isStreaming && <Text color="cyan">▍</Text>}
          </Box>
          {item.reasoning && (
            <Box width="100%" marginBottom={1}>
              <Text dimColor wrap="wrap">
                <Text color="gray" bold>thinking </Text>
                {item.reasoning}
              </Text>
            </Box>
          )}
          <Box width="100%">
            <Markdown content={item.text ?? ""} />
          </Box>
        </Box>
      );

    case "tool_call":
      return (
        <Box marginY={1}>
          <ToolPill name={item.toolName || "?"} status="running" />
        </Box>
      );

    case "tool_result":
      return <ToolResultView item={item} items={items} fileSnapshots={fileSnapshots} />;

    case "system":
      return (
        <Box marginY={1}>
          <Text wrap="wrap">
            <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : "gray"}>
              {item.level === "error" ? "⚠ " : "· "}
              {item.text}
            </Text>
          </Text>
        </Box>
      );
  }
}
