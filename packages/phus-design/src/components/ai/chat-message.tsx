"use client";

import * as React from "react";
import { Bot, User, AlertCircle } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { Avatar, AvatarFallback } from "../ui/avatar.js";
import { Markdown } from "./markdown.js";
import { StreamingCursor } from "./streaming-cursor.js";
import { ToolCallCard, type ToolCallCardProps } from "./tool-call-card.js";
import { ImagePreview } from "./image-preview.js";

export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessageProps {
	role: ChatMessageRole;
	content: string;
	isStreaming?: boolean;
	toolCalls?: Array<Pick<ToolCallCardProps, "name" | "arguments" | "state" | "error">>;
	images?: string[];
	className?: string;
}

export function ChatMessage({
	role,
	content,
	isStreaming = false,
	toolCalls,
	images,
	className,
}: ChatMessageProps) {
	const isUser = role === "user";
	const isAssistant = role === "assistant";
	const isSystem = role === "system";

	const avatar = isUser ? (
		<AvatarFallback className="bg-primary text-primary-foreground">
			<User className="h-4 w-4" />
		</AvatarFallback>
	) : isAssistant ? (
		<AvatarFallback className="bg-muted text-muted-foreground">
			<Bot className="h-4 w-4" />
		</AvatarFallback>
	) : (
		<AvatarFallback className="bg-destructive/10 text-destructive">
			<AlertCircle className="h-4 w-4" />
		</AvatarFallback>
	);

	return (
		<div
			className={cn(
				"flex gap-3 animate-fade-in",
				isUser ? "flex-row-reverse" : "flex-row",
				className,
			)}
		>
			<Avatar className="h-8 w-8 shrink-0">{avatar}</Avatar>

			<div
				className={cn(
					"flex min-w-0 max-w-[85%] flex-col gap-2 sm:max-w-[80%]",
					isUser ? "items-end" : "items-start",
				)}
			>
				<div
					className={cn(
						"relative overflow-hidden rounded-2xl px-4 py-3 text-sm",
						isUser
							? "bg-primary text-primary-foreground"
							: isSystem
								? "border bg-destructive/5 text-destructive"
								: "border bg-card text-card-foreground shadow-sm",
					)}
				>
					{isAssistant ? (
						<Markdown>{content}</Markdown>
					) : (
						<div className="whitespace-pre-wrap">{content}</div>
					)}
					{isStreaming && <StreamingCursor />}
				</div>

				{images && images.length > 0 && (
					<div className={cn("grid gap-2", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
						{images.map((src, i) => (
							<ImagePreview key={i} src={src} alt={`attachment ${i + 1}`} className="max-w-xs" />
						))}
					</div>
				)}

				{toolCalls && toolCalls.length > 0 && (
					<div className="w-full space-y-2">
						{toolCalls.map((tc, i) => (
							<ToolCallCard key={i} {...tc} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
