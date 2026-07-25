"use client";

import * as React from "react";
import { ImageOff, ZoomIn } from "lucide-react";

import { cn } from "../../lib/utils.js";

export interface ImagePreviewProps {
	src: string;
	alt?: string;
	className?: string;
	fit?: "cover" | "contain";
}

export function ImagePreview({
	src,
	alt = "",
	className,
	fit = "cover",
}: ImagePreviewProps) {
	const [error, setError] = React.useState(false);

	if (error) {
		return (
			<div
				className={cn(
					"flex aspect-video w-full max-w-md items-center justify-center rounded-lg border bg-muted text-muted-foreground",
					className,
				)}
			>
				<ImageOff className="h-6 w-6" />
				<span className="ml-2 text-xs">Image failed to load</span>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"group relative overflow-hidden rounded-lg border bg-muted",
				className,
			)}
		>
			<img
				src={src}
				alt={alt}
				loading="lazy"
				onError={() => setError(true)}
				className={cn(
					"h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
					fit === "contain" && "object-contain",
				)}
			/>
			<a
				href={src}
				target="_blank"
				rel="noreferrer"
				className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity hover:bg-black/20 hover:opacity-100"
				aria-label="Open image"
			>
				<ZoomIn className="h-6 w-6 text-white drop-shadow" />
			</a>
		</div>
	);
}
