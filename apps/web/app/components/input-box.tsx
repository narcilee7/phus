"use client";

import { useCallback, useState } from "react";

interface InputBoxProps {
  onSend: (content: string) => void | Promise<void>;
  onAbort?: () => void;
  isBusy?: boolean;
  placeholder?: string;
}

export function InputBox({
  onSend,
  onAbort,
  isBusy = false,
  placeholder = "Type a message…",
}: InputBoxProps) {
  const [value, setValue] = useState("");

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || isBusy) return;
    setValue("");
    await onSend(trimmed);
  }, [value, isBusy, onSend]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        {isBusy ? (
          <button
            type="button"
            onClick={onAbort}
            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
