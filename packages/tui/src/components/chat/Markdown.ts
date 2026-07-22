// src/tui/components/chat/Markdown.ts
// Lightweight Markdown renderer. Uses `marked.lexer` to tokenize, then
// walks the token tree and produces an array of plain strings with
// inline ANSI styling. No React, no ink.
//
// This intentionally does NOT cover every markdown feature — we focus
// on what assistant output actually contains: paragraphs, headings,
// bullet lists, code fences, blockquotes, inline formatting, links.
// Tables are rendered as plain pipe-separated lines.

import { marked, type Token, type Tokens } from "marked";
import { colorize, visibleWidth, wrapTextWithAnsi } from "../../runtime/text-utils.js";
import { CodeBlock } from "./CodeBlock.js";
import type { Component } from "../../vendor/pi-tui/tui.js";

function renderInline(tokens: Token[] | undefined): string {
	if (!tokens) return "";
	return tokens
		.map((t) => {
			switch (t.type) {
				case "text":
				case "escape":
					return (t as Tokens.Text | Tokens.Escape).text;
				case "strong":
					return colorize(renderInline((t as Tokens.Strong).tokens), "bold");
				case "em":
					return colorize(renderInline((t as Tokens.Em).tokens), "italic");
				case "del":
					return colorize(renderInline((t as Tokens.Del).tokens), "strikethrough");
				case "codespan":
					// Inline code: yellow background, BLACK foreground.
					// The previous `yellow, black` (yellow fg + black bg)
					// rendered the codespan bg as the same black as the
					// terminal — on dark themes `startup.sh` literally
					// disappeared. Inverse the pairing so the bg defines
					// the highlight and stays visible on both themes.
					return colorize((t as Tokens.Codespan).text, "black", "yellow");
				case "link":
					return colorize(renderInline((t as Tokens.Link).tokens), "cyan", "underline");
				case "br":
					return "\n";
				default:
					return (t as { text?: string }).text ?? "";
			}
		})
		.join("");
}

function renderTable(token: Tokens.Table): string[] {
	const rows: string[][] = [
		token.header.map((c) => c.text),
		...token.rows.map((r) => r.map((c) => c.text)),
	];
	const colCount = token.header.length;
	const widths: number[] = Array(colCount).fill(0);
	for (const row of rows) {
		for (let i = 0; i < colCount; i++) {
			widths[i] = Math.max(widths[i]!, (row[i] ?? "").length);
		}
	}
	const fmt = (row: string[], header: boolean): string => {
		const cells = row.map((cell, i) => {
			const pad = " ".repeat(Math.max(0, widths[i]! - cell.length));
			return header ? colorize(`${cell}${pad}`, "bold", "cyan") : `${cell}${pad}`;
		});
		return colorize("│ ", "dim") + cells.join(colorize(" │ ", "dim")) + colorize(" │", "dim");
	};
	const sep = colorize(
		"├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤",
		"dim",
	);
	return [fmt(rows[0]!, true), sep, ...rows.slice(1).map((r) => fmt(r, false))];
}

/**
 * Render markdown text to an array of plain (ANSI-styled) lines,
 * wrapping to `width`. Code fences are rendered as separate CodeBlock
 * components — pass `width` so they can be embedded inline.
 *
 * For streaming output, prefer `renderMarkdownIncremental` (M3).
 */
export function renderMarkdown(content: string, width: number): string[] {
	if (!content) return [""];
	const tokens = marked.lexer(content);
	const out: string[] = [];
	for (const t of tokens) {
		switch (t.type) {
			case "paragraph":
				out.push(...wrapTextWithAnsi(renderInline((t as Tokens.Paragraph).tokens), width));
				break;
			case "heading": {
				const h = t as Tokens.Heading;
				const text = renderInline(h.tokens);
				const prefix = "#".repeat(h.depth) + " ";
				out.push(...wrapTextWithAnsi(colorize(prefix + text, "bold", "cyan"), width));
				break;
			}
			case "blockquote": {
				const bq = t as Tokens.Blockquote;
				const inner = renderMarkdown(bq.text, width - 2);
				for (const line of inner) out.push(colorize("│ ", "dim") + line);
				break;
			}
			case "code": {
				const code = (t as Tokens.Code).text;
				const lang = (t as Tokens.Code).lang ?? undefined;
				const block = new CodeBlock({ code, language: lang });
				out.push(...block.render(width));
				break;
			}
			case "list": {
				const list = t as Tokens.List;
				let idx = 0;
				for (const item of list.items) {
					idx++;
					const bullet = list.ordered ? `${idx}.` : "•";
					const text = item.text.replace(/\n+$/, "");
					const inner = renderMarkdown(text, width - bullet.length - 1);
					if (inner.length === 0) continue;
					inner[0] = `${colorize(bullet, "dim")} ${inner[0]}`;
					for (let i = 1; i < inner.length; i++) {
						inner[i] = " ".repeat(bullet.length + 1) + inner[i];
					}
					out.push(...inner);
				}
				break;
			}
			case "table":
				out.push(...renderTable(t as Tokens.Table));
				break;
			case "hr":
				out.push(colorize("─".repeat(Math.max(8, width)), "dim"));
				break;
			case "space":
				break;
			default: {
				const text = (t as { text?: string }).text ?? "";
				if (text) out.push(...wrapTextWithAnsi(text, width));
				break;
			}
		}
		out.push("");
	}
	// Trim trailing blank lines.
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out.length > 0 ? out : [""];
}

/**
 * Component wrapper for embedding a markdown block in a Container.
 */
export class MarkdownBlock implements Component {
	private cached: { content: string; width: number; lines: string[] } | undefined;
	constructor(private readonly content: string) {}
	invalidate(): void {
		this.cached = undefined;
	}
	render(width: number): string[] {
		if (this.cached && this.cached.content === this.content && this.cached.width === width) {
			return this.cached.lines;
		}
		const lines = renderMarkdown(this.content, Math.max(1, width));
		this.cached = { content: this.content, width, lines };
		return lines;
	}
}

void visibleWidth;
