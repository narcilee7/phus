"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";

export interface CodeBlockProps {
	code: string;
	language?: string;
	className?: string;
	showLineNumbers?: boolean;
}

export function CodeBlock({
	code,
	language = "text",
	className,
	showLineNumbers = false,
}: CodeBlockProps) {
	const [copied, setCopied] = React.useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// ignore
		}
	};

	return (
		<div className={cn("group relative my-3 overflow-hidden rounded-lg border", className)}>
			<div className="flex items-center justify-between border-b bg-muted px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">
					{language}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 gap-1 px-2 text-xs"
					onClick={handleCopy}
					aria-label="Copy code"
				>
					{copied ? (
						<Check className="h-3.5 w-3.5" />
					) : (
						<Copy className="h-3.5 w-3.5" />
					)}
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<SyntaxHighlighter
				language={language}
				style={oneDark}
				showLineNumbers={showLineNumbers}
				customStyle={{
					margin: 0,
					borderRadius: 0,
					fontSize: "0.8125rem",
					lineHeight: "1.6",
					padding: "1rem",
				}}
				wrapLongLines
			>
				{code.replace(/\n$/, "")}
			</SyntaxHighlighter>
		</div>
	);
}
