"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Wrench } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { Badge } from "../ui/badge.js";

export type ToolCallState = "pending" | "running" | "success" | "error";

export interface ToolCallCardProps {
	name: string;
	arguments?: Record<string, unknown>;
	state?: ToolCallState;
	error?: string;
	className?: string;
}

export function ToolCallCard({
	name,
	arguments: args = {},
	state = "pending",
	error,
	className,
}: ToolCallCardProps) {
	const [open, setOpen] = React.useState(false);

	const stateIcon = {
		pending: <Wrench className="h-3.5 w-3.5 text-muted-foreground" />,
		running: <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />,
		success: <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />,
		error: <XCircle className="h-3.5 w-3.5 text-destructive" />,
	}[state];

	const stateLabel = {
		pending: "Pending",
		running: "Running",
		success: "Done",
		error: "Failed",
	}[state];

	return (
		<div
			className={cn(
				"rounded-lg border bg-card text-card-foreground shadow-sm",
				className,
			)}
		>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
			>
				<div className="flex items-center gap-2 overflow-hidden">
					{stateIcon}
					<span className="truncate font-mono text-sm font-medium">{name}</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Badge variant="secondary" className="text-[10px]">
						{stateLabel}
					</Badge>
					{open ? (
						<ChevronDown className="h-4 w-4 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 text-muted-foreground" />
					)}
				</div>
			</button>
			{open && (
				<div className="border-t px-3 py-2">
					<pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
						{JSON.stringify(args, null, 2)}
					</pre>
					{error && (
						<p className="mt-2 text-xs text-destructive">{error}</p>
					)}
				</div>
			)}
		</div>
	);
}
