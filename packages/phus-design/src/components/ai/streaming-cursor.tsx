"use client";

import { cn } from "../../lib/utils.js";

export interface StreamingCursorProps {
	className?: string;
}

export function StreamingCursor({ className }: StreamingCursorProps) {
	return (
		<span
			className={cn(
				"ml-0.5 inline-block h-2 w-2 animate-pulse-dot rounded-full bg-accent align-middle",
				className,
			)}
		/>
	);
}
