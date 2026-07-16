// src/tui/components/MultiLineInput.tsx
// Multi-line prompt input with history navigation (Shift+Enter for newline,
// Enter to submit, Up/Down for history when on the first/last line).

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

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
}

interface Cursor {
  line: number;
  col: number;
}

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

export function MultiLineInput({
  value,
  onChange,
  onSubmit,
  busy = false,
  showHint = true,
  placeholder,
  isActive = true,
  suggestions = [],
}: MultiLineInputProps) {
  const [cursor, setCursor] = useState<Cursor>({ line: 0, col: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  const query = value.startsWith("/") && !value.includes("\n") ? value.slice(1) : "";
  const matches = suggestions
    .filter((s) => s.startsWith(query) && !s.includes(" "))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 8);
  const showSuggestions = isActive && suggestionsOpen && query.length > 0 && matches.length > 0;

  useEffect(() => {
    setSelectedSuggestion(0);
    setSuggestionsOpen(true);
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

    if (showSuggestions) {
      if (key.escape) {
        setSuggestionsOpen(false);
        return;
      }
      if (key.tab || key.downArrow) {
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
          onChange(`/${chosen} `);
        }
        return;
      }
    }

    if (key.tab || (key.shift && key.tab)) {
      return;
    }

    if (key.return) {
      if (key.shift) {
        const { value: next, cursor: nextCursor } = setValueAtCursor(value, clampCursor(value, cursor), "\n");
        onChange(next);
        setCursor({ line: nextCursor.line + 1, col: 0 });
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
        setCursor({ line: cur.line - 1, col: Math.min(cur.col, prevLine.length) });
      } else {
        loadHistory(-1);
      }
      return;
    }

    if (key.downArrow) {
      if (cur.line < lines.length - 1) {
        const nextLine = lines[cur.line + 1]!;
        setCursor({ line: cur.line + 1, col: Math.min(cur.col, nextLine.length) });
      } else {
        loadHistory(1);
      }
      return;
    }

    if (key.leftArrow) {
      if (cur.col > 0) {
        setCursor({ line: cur.line, col: cur.col - 1 });
      } else if (cur.line > 0) {
        const prevLine = lines[cur.line - 1]!;
        setCursor({ line: cur.line - 1, col: prevLine.length });
      }
      return;
    }

    if (key.rightArrow) {
      const line = lines[cur.line]!;
      if (cur.col < line.length) {
        setCursor({ line: cur.line, col: cur.col + 1 });
      } else if (cur.line < lines.length - 1) {
        setCursor({ line: cur.line + 1, col: 0 });
      }
      return;
    }

    if (key.home) {
      setCursor({ line: cur.line, col: 0 });
      return;
    }

    if (key.end) {
      const line = lines[cur.line]!;
      setCursor({ line: cur.line, col: line.length });
      return;
    }

    if (key.backspace) {
      if (cur.col > 0) {
        const line = lines[cur.line]!;
        lines[cur.line] = line.slice(0, cur.col - 1) + line.slice(cur.col);
        onChange(lines.join("\n"));
        setCursor({ line: cur.line, col: cur.col - 1 });
      } else if (cur.line > 0) {
        const prevLine = lines[cur.line - 1]!;
        const currentLine = lines[cur.line]!;
        lines[cur.line - 1] = prevLine + currentLine;
        lines.splice(cur.line, 1);
        onChange(lines.join("\n"));
        setCursor({ line: cur.line - 1, col: prevLine.length });
      }
      return;
    }

    if (key.delete) {
      const line = lines[cur.line]!;
      if (cur.col < line.length) {
        lines[cur.line] = line.slice(0, cur.col) + line.slice(cur.col + 1);
        onChange(lines.join("\n"));
      } else if (cur.line < lines.length - 1) {
        lines[cur.line] = line + lines[cur.line + 1]!;
        lines.splice(cur.line + 1, 1);
        onChange(lines.join("\n"));
      }
      return;
    }

    // Ignore lone control keys without printable input.
    if (!input || (input.length === 1 && input.charCodeAt(0) < 32)) return;

    const { value: next, cursor: nextCursor } = setValueAtCursor(value, cur, input);
    onChange(next);
    setCursor(nextCursor);
  }, { isActive });

  const lines = value.split("\n");
  const cur = clampCursor(value, cursor);
  const showPlaceholder = value.length === 0 && showHint && placeholder;

  return (
    <Box flexDirection="column" width="100%">
      {showPlaceholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        lines.map((line, idx) => {
          if (idx !== cur.line) {
            return (
              <Text key={idx} wrap="wrap">
                {line}
              </Text>
            );
          }
          const before = line.slice(0, cur.col);
          const at = line.slice(cur.col, cur.col + 1) || " ";
          const after = line.slice(cur.col + 1);
          return (
            <Text key={idx} wrap="wrap">
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
          {matches.map((m, idx) => (
            <Text key={m} wrap="wrap">
              {idx === selectedSuggestion ? (
                <Text backgroundColor="cyan" color="black">
                  › /{m}
                </Text>
              ) : (
                <Text dimColor>  /{m}</Text>
              )}
            </Text>
          ))}
          <Text dimColor>↑↓ navigate · Enter complete · Esc close</Text>
        </Box>
      )}
    </Box>
  );
}
