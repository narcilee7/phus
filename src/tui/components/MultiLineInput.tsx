// src/tui/components/MultiLineInput.tsx
// Multi-line prompt input with history navigation (Shift+Enter for newline,
// Enter to submit, Up/Down for history when on the first/last line).

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import Fuse from "fuse.js";
import {
  displayWidth,
  findCursorDisplayRow,
  wrapLineToRows,
} from "@/tui/components/terminal-width.js";
import { useBottomOverlay } from "@/tui/layout-context.js";

export interface MultiLineInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
  busy?: boolean;
  showHint?: boolean;
  placeholder?: string;
  isActive?: boolean;
  /** Command names (without leading slash) to suggest when user types "/". */
  suggestions?: string[];
  /** File paths to suggest when user types "@". */
  mentionSuggestions?: string[];
}

interface Cursor {
  line: number;
  col: number;
}

const VISIBLE_SUGGESTIONS = 4;
const VISIBLE_MENTIONS = 4;

function clampCursor(value: string, cursor: Cursor): Cursor {
  const lines = value.split("\n");
  const line = Math.max(0, Math.min(cursor.line, lines.length - 1));
  const col = Math.max(0, Math.min(cursor.col, lines[line]!.length));
  return { line, col };
}

function setValueAtCursor(value: string, cursor: Cursor, insert: string): { value: string; cursor: Cursor } {
  const lines = value.split("\n");
  const line = lines[cursor.line]!;
  const before = line.slice(0, cursor.col);
  const after = line.slice(cursor.col);
  lines[cursor.line] = before + insert + after;
  return {
    value: lines.join("\n"),
    cursor: { line: cursor.line, col: cursor.col + insert.length },
  };
}

interface MentionState {
  query: string;
  atIndex: number;
  lineIndex: number;
}

function findMentionState(value: string, cursor: Cursor): MentionState | null {
  const lines = value.split("\n");
  const cur = clampCursor(value, cursor);
  const line = lines[cur.line] ?? "";
  const before = line.slice(0, cur.col);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const query = before.slice(atIndex + 1);
  if (query.includes(" ")) return null;
  return { query, atIndex, lineIndex: cur.line };
}

export function MultiLineInput({
  value,
  onChange,
  onSubmit,
  busy = false,
  showHint = true,
  placeholder,
  isActive = true,
  suggestions = [],
  mentionSuggestions = [],
}: MultiLineInputProps) {
  const [cursor, setCursor] = useState<Cursor>({ line: 0, col: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [selectedMention, setSelectedMention] = useState(0);
  const [mentionsOpen, setMentionsOpen] = useState(true);
  // Refs mirror value/cursor so rapid input (e.g. terminal paste) can read
  // the latest state synchronously instead of seeing a stale React snapshot.
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  // Heuristic: if input events arrive <50ms apart, treat them as a terminal
  // paste so that embedded newlines/tabs are inserted literally instead of
  // submitting or triggering shortcuts.
  const lastInputAtRef = useRef<number | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const isSlashMode = value.startsWith("/") && !value.includes("\n");
  const query = isSlashMode ? value.slice(1) : "";
  const matches = isSlashMode
    ? suggestions
        .filter((s) => s.startsWith(query) && !s.includes(" "))
        .sort((a, b) => a.localeCompare(b))
    : [];
  const showSuggestions = isActive && suggestionsOpen && isSlashMode && matches.length > 0;
  const suggestionStart =
    showSuggestions && matches.length > VISIBLE_SUGGESTIONS
      ? Math.max(0, Math.min(selectedSuggestion, matches.length - VISIBLE_SUGGESTIONS))
      : 0;
  const visibleSuggestions = matches.slice(suggestionStart, suggestionStart + VISIBLE_SUGGESTIONS);

  const mentionState = findMentionState(value, cursor);
  const mentionMatches = mentionState && mentionSuggestions.length > 0
    ? new Fuse(mentionSuggestions, { threshold: 0.4 })
        .search(mentionState.query)
        .map((r) => r.item)
    : [];
  const showMentions = isActive && mentionsOpen && !!mentionState && mentionMatches.length > 0;
  const mentionStart =
    showMentions && mentionMatches.length > VISIBLE_MENTIONS
      ? Math.max(0, Math.min(selectedMention, mentionMatches.length - VISIBLE_MENTIONS))
      : 0;
  const visibleMentions = mentionMatches.slice(mentionStart, mentionStart + VISIBLE_MENTIONS);

  const suggestionRows = showSuggestions ? Math.min(matches.length, VISIBLE_SUGGESTIONS) + 2 : 0;
  const mentionRows = showMentions ? Math.min(mentionMatches.length, VISIBLE_MENTIONS) + 2 : 0;
  useBottomOverlay(suggestionRows + mentionRows, showSuggestions || showMentions);

  useEffect(() => {
    setSelectedSuggestion(0);
    setSuggestionsOpen(true);
    setSelectedMention(0);
    setMentionsOpen(true);
  }, [value]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      setHistory((prev) => {
        if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev;
        return [...prev.slice(-99), trimmed];
      });
    }
    setHistoryIndex(null);
    setDraft("");
    setCursor({ line: 0, col: 0 });
    onSubmit(value);
  }, [value, onSubmit]);

  const loadHistory = useCallback((delta: -1 | 1) => {
    setHistoryIndex((current) => {
      if (history.length === 0) return current;

      if (delta === -1) {
        if (current === null) {
          setDraft(value);
          const idx = history.length - 1;
          onChange(history[idx]!);
          return idx;
        }
        const idx = Math.max(0, current - 1);
        onChange(history[idx]!);
        return idx;
      }

      // delta === 1
      if (current === null) return current;
      if (current >= history.length - 1) {
        onChange(draft);
        return null;
      }
      const idx = current + 1;
      onChange(history[idx]!);
      return idx;
    });
  }, [history, value, onChange, draft]);

  useInput((input, key) => {
    // Let App.tsx handle these global shortcuts.
    if ((key.ctrl && input === "c") || (key.ctrl && input === "l") || key.pageUp || key.pageDown) {
      return;
    }

    const now = Date.now();
    const isRapidPaste = lastInputAtRef.current !== null && now - lastInputAtRef.current < 50;
    lastInputAtRef.current = now;

    // Work on refs so rapid input (e.g. paste) sees the latest value/cursor.
    let value = valueRef.current;
    let cursor = cursorRef.current;

    function commit(nextValue: string, nextCursor: Cursor) {
      valueRef.current = nextValue;
      cursorRef.current = nextCursor;
      value = nextValue;
      cursor = nextCursor;
      onChange(nextValue);
      setCursor(nextCursor);
    }

    function commitValue(nextValue: string) {
      valueRef.current = nextValue;
      value = nextValue;
      onChange(nextValue);
    }

    function commitCursor(nextCursor: Cursor) {
      cursorRef.current = nextCursor;
      cursor = nextCursor;
      setCursor(nextCursor);
    }

    if (showMentions && mentionState) {
      if (key.escape) {
        setMentionsOpen(false);
        return;
      }
      if (key.tab || key.return) {
        const chosen = mentionMatches[selectedMention]!;
        const lines = value.split("\n");
        const line = lines[mentionState.lineIndex]!;
        const before = line.slice(0, mentionState.atIndex);
        const after = line.slice(cursor.col);
        lines[mentionState.lineIndex] = `${before}@${chosen} ${after}`;
        commit(lines.join("\n"), { line: mentionState.lineIndex, col: before.length + chosen.length + 2 });
        return;
      }
      if (key.downArrow) {
        setSelectedMention((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (key.upArrow || (key.shift && key.tab)) {
        setSelectedMention((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
    }

    if (showSuggestions) {
      if (key.escape) {
        setSuggestionsOpen(false);
        return;
      }
      if (key.tab) {
        const chosen = matches[selectedSuggestion]!;
        commitValue(`/${chosen} `);
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion((i) => (i + 1) % matches.length);
        return;
      }
      if (key.shift && key.tab) {
        setSelectedSuggestion((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (key.upArrow) {
        setSelectedSuggestion((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (key.return) {
        const chosen = matches[selectedSuggestion]!;
        if (chosen === query) {
          submit();
        } else {
          commitValue(`/${chosen} `);
        }
        return;
      }
    }

    if (key.tab || (key.shift && key.tab)) {
      if (isRapidPaste) {
        const { value: next, cursor: nextCursor } = setValueAtCursor(value, clampCursor(value, cursor), "\t");
        commit(next, nextCursor);
      }
      return;
    }

    if (key.return) {
      if (key.shift || isRapidPaste) {
        const { value: next, cursor: nextCursor } = setValueAtCursor(value, clampCursor(value, cursor), "\n");
        commit(next, { line: nextCursor.line + 1, col: 0 });
      } else {
        submit();
      }
      return;
    }

    const lines = value.split("\n");
    const cur = clampCursor(value, cursor);

    if (key.upArrow) {
      if (cur.line > 0) {
        const prevLine = lines[cur.line - 1]!;
        commitCursor({ line: cur.line - 1, col: Math.min(cur.col, prevLine.length) });
      } else {
        loadHistory(-1);
      }
      return;
    }

    if (key.downArrow) {
      if (cur.line < lines.length - 1) {
        const nextLine = lines[cur.line + 1]!;
        commitCursor({ line: cur.line + 1, col: Math.min(cur.col, nextLine.length) });
      } else {
        loadHistory(1);
      }
      return;
    }

    if (key.leftArrow) {
      if (cur.col > 0) {
        commitCursor({ line: cur.line, col: cur.col - 1 });
      } else if (cur.line > 0) {
        const prevLine = lines[cur.line - 1]!;
        commitCursor({ line: cur.line - 1, col: prevLine.length });
      }
      return;
    }

    if (key.rightArrow) {
      const line = lines[cur.line]!;
      if (cur.col < line.length) {
        commitCursor({ line: cur.line, col: cur.col + 1 });
      } else if (cur.line < lines.length - 1) {
        commitCursor({ line: cur.line + 1, col: 0 });
      }
      return;
    }

    if (key.home) {
      commitCursor({ line: cur.line, col: 0 });
      return;
    }

    if (key.end) {
      const line = lines[cur.line]!;
      commitCursor({ line: cur.line, col: line.length });
      return;
    }

    // Treat both backspace and delete as "delete character before cursor".
    // Ink can't reliably distinguish Mac Delete (\x7f) from PC forward-delete
    // (\x1b[3~): both are reported as key.delete. For a chat input the cursor
    // is almost always at the end of the line, so backward deletion is the
    // behavior users expect from the Delete/Backspace key.
    if (key.backspace || key.delete) {
      if (cur.col > 0) {
        const line = lines[cur.line]!;
        lines[cur.line] = line.slice(0, cur.col - 1) + line.slice(cur.col);
        commit(lines.join("\n"), { line: cur.line, col: cur.col - 1 });
      } else if (cur.line > 0) {
        const prevLine = lines[cur.line - 1]!;
        const currentLine = lines[cur.line]!;
        lines[cur.line - 1] = prevLine + currentLine;
        lines.splice(cur.line, 1);
        commit(lines.join("\n"), { line: cur.line - 1, col: prevLine.length });
      }
      return;
    }

    // Ignore lone control keys without printable input.
    if (!input || (input.length === 1 && input.charCodeAt(0) < 32)) return;

    const { value: next, cursor: nextCursor } = setValueAtCursor(value, cur, input);
    commit(next, nextCursor);
  }, { isActive });

  const { stdout } = useStdout();
  // Reserve a few columns for the prompt prefix and input box borders/padding.
  const maxWidth = Math.max(10, (stdout.columns ?? 80) - 4);
  const MAX_DISPLAY_ROWS = 5;

  const lines = value.split("\n");
  const cur = clampCursor(value, cursor);
  const showPlaceholder = value.length === 0 && showHint && placeholder;

  // Build display rows using terminal column widths so CJK characters wrap
  // at the correct boundary and don't throw off the measured height.
  interface DisplayRow {
    lineIndex: number;
    rowInLine: number;
    text: string;
    width: number;
  }

  const allDisplayRows: DisplayRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const wrapped = wrapLineToRows(lines[i]!, maxWidth);
    for (let r = 0; r < wrapped.length; r++) {
      allDisplayRows.push({
        lineIndex: i,
        rowInLine: r,
        text: wrapped[r]!.text,
        width: wrapped[r]!.width,
      });
    }
  }

  const cursorDisplayRow = findCursorDisplayRow(cur, lines, maxWidth);
  let startRow = 0;
  if (allDisplayRows.length > MAX_DISPLAY_ROWS) {
    startRow = Math.max(
      0,
      Math.min(
        cursorDisplayRow - Math.floor(MAX_DISPLAY_ROWS / 2),
        allDisplayRows.length - MAX_DISPLAY_ROWS,
      ),
    );
  }
  const visibleRows = allDisplayRows.slice(startRow, startRow + MAX_DISPLAY_ROWS);
  const cursorLocalRow = cursorDisplayRow - startRow;
  const cursorVisible =
    cursorDisplayRow >= startRow && cursorDisplayRow < startRow + MAX_DISPLAY_ROWS;

  return (
    <Box flexDirection="column" width="100%">
      {showPlaceholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        visibleRows.map((row, idx) => {
          const key = `${row.lineIndex}-${row.rowInLine}`;
          if (!cursorVisible || idx !== cursorLocalRow) {
            return (
              <Text key={key} wrap="wrap">
                {row.text}
              </Text>
            );
          }

          // Cursor row: split into before/at/after within this wrapped row.
          const line = lines[row.lineIndex]!;
          const wrapped = wrapLineToRows(line, maxWidth);
          let rowStartIdx = 0;
          for (let r = 0; r < row.rowInLine; r++) {
            rowStartIdx += wrapped[r]!.text.length;
          }
          const before = line.slice(rowStartIdx, cur.col);
          const at = line.slice(cur.col, cur.col + 1) || " ";
          const after = line.slice(cur.col + 1, rowStartIdx + row.text.length);
          return (
            <Text key={key} wrap="wrap">
              {before}
              <Text backgroundColor="cyan" color="black">
                {at}
              </Text>
              {after}
            </Text>
          );
        })
      )}
      {showSuggestions && (
        <Box flexDirection="column" marginTop={1}>
          {visibleSuggestions.map((m, idx) => {
            const actualIndex = suggestionStart + idx;
            return (
              <Text key={m} wrap="wrap">
                {actualIndex === selectedSuggestion ? (
                  <Text backgroundColor="cyan" color="black">
                    › /{m}
                  </Text>
                ) : (
                  <Text dimColor>  /{m}</Text>
                )}
              </Text>
            );
          })}
          <Text dimColor>↑↓ navigate · Tab complete · Enter submit · Esc close</Text>
        </Box>
      )}
      {showMentions && (
        <Box flexDirection="column" marginTop={1}>
          {visibleMentions.map((m, idx) => {
            const actualIndex = mentionStart + idx;
            return (
              <Text key={m} wrap="wrap">
                {actualIndex === selectedMention ? (
                  <Text backgroundColor="cyan" color="black">
                    › @{m}
                  </Text>
                ) : (
                  <Text dimColor>  @{m}</Text>
                )}
              </Text>
            );
          })}
          <Text dimColor>↑↓ navigate · Tab complete · Enter submit · Esc close</Text>
        </Box>
      )}
    </Box>
  );
}
