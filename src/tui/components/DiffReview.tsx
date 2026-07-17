// src/tui/components/DiffReview.tsx
// Standalone file-write diff review card with accept/reject/edit actions.

import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { DiffView } from "@/tui/components/DiffView.js";
import { DiffReviewContext } from "@/tui/components/DiffReviewContext.js";
import { TuiFocusContext } from "@/tui/components/TuiFocusContext.js";

export interface DiffReviewProps {
  path: string;
  oldContent: string;
  newContent: string;
  /** Optional stable id, useful in tests. Falls back to React.useId(). */
  id?: string;
}

export function DiffReview({ path, oldContent, newContent, id: idProp }: DiffReviewProps) {
  const generatedId = React.useId();
  const id = idProp ?? generatedId;
  const ctx = React.useContext(DiffReviewContext);
  const focusCtx = React.useContext(TuiFocusContext);
  const { isFocused } = useFocus({ isActive: true, id, autoFocus: false });

  React.useEffect(() => {
    if (!focusCtx) return;
    if (isFocused) {
      focusCtx.setFocused(id, "diffreview");
    } else if (focusCtx.focusedId === id) {
      focusCtx.setFocused(null);
    }
  }, [isFocused, id, focusCtx]);

  const active = focusCtx?.focusedId === id;

  useInput((input, key) => {
    if (!active || !ctx) return;
    if (key.ctrl || key.meta) return;
    if (input === "a") {
      ctx.onAction({ type: "accept", path });
    } else if (input === "r") {
      ctx.onAction({ type: "reject", path, oldContent });
    } else if (input === "e") {
      ctx.onAction({ type: "edit", path, newContent });
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={active ? "cyan" : "gray"}
      paddingX={1}
      width="100%"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text dimColor>{path}</Text>
        <Box flexDirection="row">
          <Text color={active ? "green" : "gray"}>accept(a)</Text>
          <Text dimColor> · </Text>
          <Text color={active ? "green" : "gray"}>reject(r)</Text>
          <Text dimColor> · </Text>
          <Text color={active ? "green" : "gray"}>edit(e)</Text>
        </Box>
      </Box>
      <DiffView oldText={oldContent} newText={newContent} />
    </Box>
  );
}
