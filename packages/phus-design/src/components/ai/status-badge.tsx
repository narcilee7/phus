"use client";

import { cn } from "../../lib/utils.js";

export type ConnectionStatus = "connected" | "disconnected" | "busy" | "idle";

export interface StatusBadgeProps {
	status: ConnectionStatus;
	className?: string;
}

const config: Record<
	ConnectionStatus,
	{ label: string; dot: string; bg: string }
> = {
	connected: {
		label: "Online",
		dot: "bg-green-500",
		bg: "bg-green-500/10 text-green-600",
	},
	busy: {
		label: "Busy",
		dot: "bg-accent",
		bg: "bg-accent/10 text-accent",
	},
	idle: {
		label: "Idle",
		dot: "bg-muted-foreground",
		bg: "bg-muted text-muted-foreground",
	},
	disconnected: {
		label: "Reconnecting…",
		dot: "bg-muted-foreground",
		bg: "bg-muted text-muted-foreground",
	},
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
	const c = config[status];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
				c.bg,
				className,
			)}
		>
			<span
				className={cn(
					"h-1.5 w-1.5 rounded-full",
					status === "busy" && "animate-pulse",
					c.dot,
				)}
			/>
			{c.label}
		</span>
	);
}
