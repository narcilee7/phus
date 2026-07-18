// src/tui/components/chat/CodeBlock.ts
// Code-fence renderer with prismjs tokenization → ANSI colors. Supports
// the same language set as the React-era CodeBlock.tsx (typescript,
// javascript, json, bash, python, yaml, markdown). For unknown
// languages, falls back to plain text.
//
// M2 surface: passive rendering (no focus). M3 will add `Focusable`
// + c/r/i keybindings wired through a CodeActionHandler reference.

import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-yaml.js";
import type { Component } from "@/vendor/pi-tui/tui.js";
import { colorize, visibleWidth } from "@/runtime/text-utils.js";

export interface CodeBlockOptions {
	code: string;
	language?: string;
	/** Show line numbers in the gutter. Default true. */
	showLineNumbers?: boolean;
}

const LANG_ALIAS: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	sh: "bash",
	shell: "bash",
	py: "python",
	md: "markdown",
};

function colorForToken(type: string): string | undefined {
	switch (type) {
		case "comment":
			return "gray";
		case "keyword":
		case "boolean":
		case "atrule":
			return "magenta";
		case "string":
		case "char":
		case "regex":
			return "green";
		case "number":
			return "yellow";
		case "function":
		case "method":
		case "function-variable":
			return "cyan";
		case "operator":
		case "punctuation":
			return "dim";
		case "tag":
		case "attr-name":
		case "attr-value":
			return "blue";
		case "property":
		case "selector":
			return "yellow";
		case "variable":
		case "variable-language":
			return "emphasis";
		default:
			return undefined;
	}
}

function tokenizeLine(code: string, lang: string | undefined): string {
	const language = lang ? (LANG_ALIAS[lang] ?? lang) : "";
	const grammar = language && Prism.languages[language] ? Prism.languages[language] : null;
	if (!grammar) return code;
	const tokens = Prism.tokenize(code, grammar) as Prism.Token[] | string;
	function walk(t: Prism.Token | string): string {
		if (typeof t === "string") return t;
		const content = Array.isArray(t.content) ? t.content.map(walk).join("") : String(t.content);
		const color = colorForToken(t.type);
		return color ? colorize(content, color) : content;
	}
	if (Array.isArray(tokens)) return tokens.map(walk).join("");
	return walk(tokens as unknown as Prism.Token);
}

export class CodeBlock implements Component {
	private readonly code: string;
	private readonly language?: string;
	private readonly showLineNumbers: boolean;
	private cached: { width: number; lines: string[] } | undefined;

	constructor(opts: CodeBlockOptions) {
		this.code = opts.code;
		this.language = opts.language;
		this.showLineNumbers = opts.showLineNumbers ?? true;
	}

	invalidate(): void {
		this.cached = undefined;
	}

	render(width: number): string[] {
		if (this.cached && this.cached.width === width) return this.cached.lines;
		const innerWidth = Math.max(1, width - 4); // 2 border + 2 padding
		const lines = this.code.replace(/\n$/, "").split("\n");
		const gutterWidth = this.showLineNumbers ? String(lines.length).length + 2 : 0;
		const contentWidth = innerWidth - gutterWidth;
		const rendered = lines.map((raw, i) => {
			const tokenized = tokenizeLine(raw, this.language);
			const contentLines = wrapPreservingAnsi(tokenized, contentWidth);
			if (!this.showLineNumbers) return contentLines;
			const num = colorize(String(i + 1).padStart(gutterWidth - 2, " "), "dim");
			return contentLines.map((ln, j) => `${num}${j === 0 ? colorize(" │ ", "dim") : " │ "}${ln}`);
		});
		// Wrap in a single-line border.
		const allRows = rendered.flat();
		const out: string[] = [];
		out.push(colorize("┌" + "─".repeat(width - 2) + "┐", "dim"));
		for (const line of allRows) {
			const padded = padRightTo(line, innerWidth + 2);
			out.push(colorize("│ ", "dim") + padded + colorize(" │", "dim"));
		}
		out.push(colorize("└" + "─".repeat(width - 2) + "┘", "dim"));
		this.cached = { width, lines: out };
		return out;
	}
}

function padRightTo(s: string, width: number): string {
	const v = visibleWidth(s);
	if (v >= width) return s;
	return s + " ".repeat(width - v);
}

/** Word-wrap a string that may contain ANSI escapes (no splitting inside an escape). */
function wrapPreservingAnsi(text: string, width: number): string[] {
	if (width <= 0) return [text];
	const out: string[] = [];
	// oxlint(no-control-regex): ANSI escape sequences are exactly what we split on.
	// eslint-disable-next-line no-control-regex
	const re = /(\x1b\[[0-9;]*[A-Za-z])|(\s+)|([^\s\x1b]+)/g;
	let m: RegExpExecArray | null;
	const tokens: string[] = [];
	while ((m = re.exec(text)) !== null) tokens.push(m[0]);
	let line = "";
	let visW = 0;
	const flush = () => {
		out.push(line);
		line = "";
		visW = 0;
	};
	for (const tok of tokens) {
		const tokW = visibleWidth(tok);
		if (tokW === 0) {
			line += tok;
			continue;
		}
		if (visW + tokW > width) {
			if (line.trimEnd()) flush();
			line = tok;
			visW = tokW;
		} else {
			line += tok;
			visW += tokW;
		}
	}
	if (line) out.push(line);
	return out.length > 0 ? out : [""];
}
