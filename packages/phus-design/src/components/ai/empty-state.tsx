"use client";

import { Bot } from "lucide-react";

import { cn } from "../../lib/utils.js";

export interface EmptyStateProps {
	title?: string;
	description?: string;
	className?: string;
}

export function EmptyState({
	title = "Phus Workbench",
	description = "Start a conversation, switch sessions, or ask Phus to explain its skills.",
	className,
}: EmptyStateProps) {
	return (
		<div className={cn("flex flex-col items-center text-center text-muted-foreground", className)}>
			<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
				<Bot className="h-7 w-7 text-accent" />
			</div>
			<h3 className="text-lg font-semibold text-foreground">{title}</h3>
			<p className="mt-1 max-w-xs text-sm">{description}</p>
		</div>
	);
}
