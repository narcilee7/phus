// src/tui/components/AssistantMessage.tsx
// Assistant message card with optional reasoning preview.

import React from "react";
import { Box, Text } from "ink";
import type { ChatItem } from "@/tui/state/state.js";
import { truncate } from "@/tui/state/state.js";
import { Markdown } from "@/tui/components/rich-text-components/Markdown.js";

function formatTokens(n: number | undefined): string | undefined {
  if (n === undefined || Number.isNaN(n)) return undefined;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number | undefined): string | undefined {
  if (n === undefined || Number.isNaN(n)) return undefined;
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function buildMetadataLine(item: ChatItem): string | undefined {
  const parts: string[] = [];
  if (item.model) parts.push(item.model);
  if (item.usage?.totalTokens !== undefined) {
    const tokens = formatTokens(item.usage.totalTokens);
    parts.push(`${tokens} tokens`);
  } else if (item.usage?.inputTokens !== undefined || item.usage?.outputTokens !== undefined) {
    const input = formatTokens(item.usage.inputTokens) ?? "?";
    const output = formatTokens(item.usage.outputTokens) ?? "?";
    parts.push(`${input} / ${output} tokens`);
  }
  const cost = formatCost(item.usage?.cost);
  if (cost) parts.push(cost);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

export function AssistantMessage({ item }: { item: ChatItem }) {
  const hasContent =
    (item.text ?? "").trim().length > 0 || (item.reasoning ?? "").length > 0;
  if (!hasContent && !item.isStreaming) return null;

  return (
    <Box flexDirection="column" marginY={1} width="100%">
      <Box>
        <Text color="cyan">⛰ </Text>
        {item.isStreaming && <Text color="cyan">▍</Text>}
      </Box>
      {item.reasoning && (
        <Box width="100%" marginBottom={1}>
          <Text dimColor wrap="wrap">
            <Text color="gray" bold>
              thinking{" "}
            </Text>
            {truncate(item.reasoning, 120)}
          </Text>
        </Box>
      )}
      <Box width="100%">
        <Markdown content={item.text ?? ""} />
      </Box>
      {(() => {
        const meta = buildMetadataLine(item);
        if (!meta) return null;
        return (
          <Box width="100%" marginTop={1}>
            <Text dimColor>{meta}</Text>
          </Box>
        );
      })()}
    </Box>
  );
}
