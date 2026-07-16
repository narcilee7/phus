// src/tui/components/Markdown.tsx
// Lightweight Markdown-to-Ink renderer backed by marked. Renders paragraphs,
// headings, lists, blockquotes, code blocks, tables and inline formatting.

import React from "react";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import { CodeBlock } from "@/tui/components/CodeBlock.js";

function renderInline(tokens: Token[] | undefined, keyPrefix: string): React.ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (t.type) {
      case "text":
      case "escape":
        return <React.Fragment key={key}>{t.text}</React.Fragment>;
      case "strong":
        return (
          <Text key={key} bold>
            {renderInline((t as Tokens.Strong).tokens, `${key}-inner`)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} italic>
            {renderInline((t as Tokens.Em).tokens, `${key}-inner`)}
          </Text>
        );
      case "del":
        return (
          <Text key={key} strikethrough>
            {renderInline((t as Tokens.Del).tokens, `${key}-inner`)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={key} color="yellow" backgroundColor="black">
            {t.text}
          </Text>
        );
      case "link":
        return (
          <Text key={key} color="cyan" underline>
            {renderInline((t as Tokens.Link).tokens, `${key}-inner`)}
          </Text>
        );
      case "br":
        return <React.Fragment key={key}>\n</React.Fragment>;
      default:
        return <React.Fragment key={key}>{(t as any).text ?? ""}</React.Fragment>;
    }
  });
}

function renderTable(token: Tokens.Table, key: string): React.ReactNode {
  const rows: string[][] = [
    token.header.map((c) => c.text),
    ...token.rows.map((r) => r.map((c) => c.text)),
  ];
  const colCount = token.header.length;
  const widths: number[] = Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      widths[i] = Math.max(widths[i]!, row[i]?.length ?? 0);
    }
  }

  const renderRow = (row: string[], isHeader: boolean) => (
    <Box key={`${key}-row`} flexDirection="row">
      <Text dimColor>│ </Text>
      {row.map((cell, idx) => {
        const pad = " ".repeat(Math.max(0, widths[idx]! - cell.length));
        const content = `${cell}${pad}`;
        return (
          <React.Fragment key={`${key}-cell-${idx}`}>
            {isHeader ? (
              <Text bold color="cyan">{content}</Text>
            ) : (
              <Text>{content}</Text>
            )}
            <Text dimColor> │ </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );

  return (
    <Box key={key} flexDirection="column" marginY={1}>
      {renderRow(rows[0]!, true)}
      <Box flexDirection="row">
        <Text dimColor>├</Text>
        {widths.map((w, idx) => (
          <React.Fragment key={`${key}-sep-${idx}`}>
            <Text dimColor>{"─".repeat(w + 2)}</Text>
            {idx < widths.length - 1 && <Text dimColor>┼</Text>}
          </React.Fragment>
        ))}
        <Text dimColor>┤</Text>
      </Box>
      {rows.slice(1).map((row, idx) => renderRow(row, false))}
    </Box>
  );
}

function renderBlock(token: Token, key: string | number): React.ReactNode {
  switch (token.type) {
    case "paragraph":
      return (
        <Box key={key} marginY={0}>
          <Text wrap="wrap">
            {renderInline((token as Tokens.Paragraph).tokens, `${key}-inline`)}
          </Text>
        </Box>
      );

    case "heading": {
      const h = token as Tokens.Heading;
      return (
        <Box key={key} marginY={1}>
          <Text bold color="cyan" wrap="wrap">
            {"#".repeat(h.depth)} {renderInline(h.tokens, `${key}-inline`)}
          </Text>
        </Box>
      );
    }

    case "code": {
      const c = token as Tokens.Code;
      return <CodeBlock key={key} code={c.text} language={c.lang} />;
    }

    case "blockquote":
      return (
        <Box
          key={key}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginY={1}
        >
          {(token as Tokens.Blockquote).tokens.map((t, i) =>
            renderBlock(t, `${key}-bq-${i}`),
          )}
        </Box>
      );

    case "list": {
      const list = token as Tokens.List;
      return (
        <Box key={key} flexDirection="column" marginY={1}>
          {list.items.map((item, idx) => {
            const bullet = list.ordered ? `${(list.start || 1) + idx}. ` : "• ";
            return (
              <Box key={`${key}-item-${idx}`} flexDirection="row">
                <Text dimColor>{bullet}</Text>
                <Box flexDirection="column" flexGrow={1}>
                  {item.tokens.map((t, i) => renderBlock(t, `${key}-item-${idx}-block-${i}`))}
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }

    case "hr":
      return (
        <Box key={key} marginY={1}>
          <Text dimColor>{"─".repeat(40)}</Text>
        </Box>
      );

    case "space":
      return null;

    case "table":
      return renderTable(token as Tokens.Table, String(key));

    case "html":
      return (
        <Box key={key} marginY={1}>
          <Text dimColor wrap="wrap">{token.text}</Text>
        </Box>
      );

    default:
      return (
        <Box key={key} marginY={1}>
          <Text dimColor wrap="wrap">{(token as any).raw ?? (token as any).text ?? ""}</Text>
        </Box>
      );
  }
}

export function Markdown({ content }: { content: string }) {
  const tokens = marked.lexer(content || "");
  return (
    <Box flexDirection="column" width="100%">
      {tokens.map((t, i) => renderBlock(t, i))}
    </Box>
  );
}
