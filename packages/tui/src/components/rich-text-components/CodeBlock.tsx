// src/tui/components/CodeBlock.tsx
// Syntax-highlighted code block using Prism.js. Maps token scopes to terminal
// colors and renders line numbers optionally. Focused blocks expose Copy,
// Run and Insert actions via the CodeActionContext.

import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import Prism from "prismjs";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-markdown.js";
import { CodeActionContext } from "@/components/rich-text-components/CodeActionContext.js";
import { TuiFocusContext } from "@/context/tui-focus-context.js";

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
};

function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase();
  return ALIASES[normalized] ?? normalized;
}

function colorForToken(type: string): string {
  switch (type) {
    case "keyword":
    case "builtin":
      return "magenta";
    case "string":
    case "char":
    case "symbol":
    case "attr-value":
      return "green";
    case "number":
      return "yellow";
    case "comment":
      return "gray";
    case "function":
    case "class-name":
      return "cyan";
    case "operator":
      return "yellow";
    case "punctuation":
      return "white";
    case "tag":
      return "red";
    case "attr-name":
      return "yellow";
    default:
      return "white";
  }
}

interface Segment {
  type?: string;
  text: string;
}

function flattenTokens(tokens: Array<string | Prism.Token>, out: Segment[] = []): Segment[] {
  for (const token of tokens) {
    if (typeof token === "string") {
      out.push({ text: token });
    } else if (Array.isArray(token.content)) {
      // The segment itself carries the type, children are flattened inside.
      out.push({ type: token.type, text: "" });
      flattenTokens(token.content, out);
    } else if (typeof token.content === "string") {
      out.push({ type: token.type, text: token.content });
    }
  }
  return out;
}

function splitByLines(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];
  for (const seg of segments) {
    const parts = seg.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
      }
      const text = parts[i] ?? "";
      if (text.length > 0 || seg.text.length === 0) {
        lines[lines.length - 1]!.push({ type: seg.type, text });
      }
    }
  }
  return lines;
}

function renderLine(line: Segment[], keyPrefix: string): React.ReactNode {
  return line.map((seg, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!seg.type) {
      return <React.Fragment key={key}>{seg.text}</React.Fragment>;
    }
    return (
      <Text key={key} color={colorForToken(seg.type)}>
        {seg.text}
      </Text>
    );
  });
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  /** Optional stable id, useful in tests. Falls back to React.useId(). */
  id?: string;
}

export function CodeBlock({ code, language, showLineNumbers = true, id: idProp }: CodeBlockProps) {
  const generatedId = React.useId();
  const id = idProp ?? generatedId;
  const ctx = React.useContext(CodeActionContext);
  const focusCtx = React.useContext(TuiFocusContext);
  const { isFocused } = useFocus({ isActive: true, id, autoFocus: false });

  React.useEffect(() => {
    if (!focusCtx) return;
    if (isFocused) {
      focusCtx.setFocused(id, "codeblock");
    } else if (focusCtx.focusedId === id) {
      focusCtx.setFocused(null);
    }
  }, [isFocused, id, focusCtx]);

  const active = focusCtx?.focusedId === id;

  useInput((input, key) => {
    if (!active || !ctx) return;
    if (key.ctrl || key.meta) return;
    if (input === "c") {
      ctx.onAction({ type: "copy", code });
    } else if (input === "r") {
      ctx.onAction({ type: "run", language: language || "text", code });
    } else if (input === "i") {
      ctx.onAction({ type: "insert", code });
    }
  });

  const lang = resolveLanguage(language || "text");
  const grammar = Prism.languages[lang] ?? Prism.languages.plaintext ?? {};
  const tokens = Prism.tokenize(code, grammar);
  const lines = splitByLines(flattenTokens(tokens));
  const maxLineNum = Math.max(1, String(lines.length).length);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={active ? "cyan" : "gray"}
      marginY={1}
    >
      <Box paddingX={1} paddingY={0} justifyContent="space-between">
        <Text dimColor>{language || "text"}</Text>
        <Box flexDirection="row">
          <Text color={active ? "green" : "gray"}>copy(c)</Text>
          <Text dimColor> · </Text>
          <Text color={active ? "green" : "gray"}>run(r)</Text>
          <Text dimColor> · </Text>
          <Text color={active ? "green" : "gray"}>insert(i)</Text>
        </Box>
      </Box>
      <Box paddingX={1} paddingY={0} flexDirection="column">
        {lines.map((line, idx) => (
          <Box key={`line-${idx}`} flexDirection="row">
            {showLineNumbers && (
              <Box marginRight={1} minWidth={maxLineNum}>
                <Text dimColor>{String(idx + 1).padStart(maxLineNum, " ")}</Text>
              </Box>
            )}
            <Text wrap="wrap">{renderLine(line, `seg-${idx}`)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
