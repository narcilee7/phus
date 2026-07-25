"use client";

import * as React from "react";
import { ArrowUp, Square } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Textarea } from "../ui/textarea.js";

export interface ChatInputProps {
	value?: string;
	onChange?: (value: string) => void;
	onSend?: (value: string) => void | Promise<void>;
	onAbort?: () => void;
	isBusy?: boolean;
	placeholder?: string;
	className?: string;
}

export function ChatInput({
	value,
	onChange,
	onSend,
	onAbort,
	isBusy = false,
	placeholder = "Message Phus…",
	className,
}: ChatInputProps) {
	const [internalValue, setInternalValue] = React.useState(value ?? "");
	const textareaRef = React.useRef<HTMLTextAreaElement>(null);

	const currentValue = value !== undefined ? value : internalValue;

	const resize = React.useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
	}, []);

	React.useEffect(() => {
		resize();
	}, [currentValue, resize]);

	const update = (next: string) => {
		setInternalValue(next);
		onChange?.(next);
	};

	const submit = async () => {
		const trimmed = currentValue.trim();
		if (!trimmed || isBusy) return;
		update("");
		if (textareaRef.current) textareaRef.current.style.height = "auto";
		await onSend?.(trimmed);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
			event.preventDefault();
			void submit();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	};

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
				<Textarea
					ref={textareaRef}
					value={currentValue}
					onChange={(e) => update(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					rows={1}
					disabled={isBusy}
					className="max-h-60 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 disabled:opacity-60"
				/>
				{isBusy ? (
					<Button
						type="button"
						size="icon"
						variant="destructive"
						className="h-9 w-9 shrink-0 rounded-xl"
						onClick={onAbort}
						aria-label="Stop"
					>
						<Square className="h-4 w-4 fill-current" />
					</Button>
				) : (
					<Button
						type="button"
						size="icon"
						className="h-9 w-9 shrink-0 rounded-xl"
						onClick={() => void submit()}
						disabled={!currentValue.trim()}
						aria-label="Send"
					>
						<ArrowUp className="h-4 w-4" />
					</Button>
				)}
			</div>
			<div className="text-center text-[11px] text-muted-foreground">
				Shift+Enter for new line · Ctrl/Cmd+Enter to send
			</div>
		</div>
	);
}
