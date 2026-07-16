// src/tui/components/DiffView.tsx
// Line-level diff renderer backed by the open-source `diff` library.

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { diffLines } from "diff";

interface DiffLine {
  kind: "added" | "removed" | "context";
  text: string;
}

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const kind = change.added ? "added" : change.removed ? "removed" : "context";
    const parts = change.value.split("\n");
    // diffLines keeps a trailing empty segment for the final newline; skip it.
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1 && parts[i] === "") continue;
      lines.push({ kind, text: parts[i]! });
    }
  }
  return lines;
}

function prefixFor(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "added":
      return "+ ";
    case "removed":
      return "- ";
    default:
      return "  ";
  }
}

function colorFor(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "added":
      return "green";
    case "removed":
      return "red";
    default:
      return "gray";
  }
}

export interface DiffViewProps {
  oldText: string;
  newText: string;
  maxContextLines?: number;
}

export function DiffView({ oldText, newText, maxContextLines = 6 }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const allLines = computeDiffLines(oldText, newText);
  const hiddenCount = expanded ? 0 : Math.max(0, allLines.length - maxContextLines);
  const visibleLines = expanded ? allLines : allLines.slice(0, maxContextLines);

  useInput((input, key) => {
    if (key.return || input === " ") {
      setExpanded((e) => !e);
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      {visibleLines.map((line, idx) => (
        <Box key={idx} flexDirection="row" width="100%">
          <Text color={colorFor(line.kind)} wrap="wrap">
            {prefixFor(line.kind)}
            {line.text}
          </Text>
        </Box>
      ))}
      {hiddenCount > 0 && (
        <Box marginTop={1}>
          <Text dimColor>… {hiddenCount} more lines — Enter/Space to expand</Text>
        </Box>
      )}
    </Box>
  );
}
