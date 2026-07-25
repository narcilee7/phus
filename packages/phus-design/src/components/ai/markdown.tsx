"use client";

import * as React from "react";
import MarkdownBase from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils.js";
import { CodeBlock } from "./code-block.js";

export interface MarkdownProps {
	children: string;
	className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
	return (
		<div className={cn("prose prose-sm max-w-none dark:prose-invert", className)}>
			<MarkdownBase
				remarkPlugins={[remarkGfm]}
				components={{
					code(props) {
						const { children, className, node, ...rest } = props;
						void node;
						const match = /language-(\w+)/.exec(className ?? "");
						const code = String(children ?? "").replace(/\n$/, "");
						if (match) {
							return <CodeBlock code={code} language={match[1]} />;
						}
						return (
							<code
								{...rest}
								className={cn(
									"rounded bg-muted px-1 py-0.5 font-mono text-xs",
									className,
								)}
							>
								{children}
							</code>
						);
					},
					pre({ children }) {
						return <>{children}</>;
					},
				}}
			>
				{children}
			</MarkdownBase>
		</div>
	);
}
