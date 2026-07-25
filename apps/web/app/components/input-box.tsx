"use client";

import { ChatInput } from "@phus/phus-design";

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
  placeholder = "Ask Phus anything…",
}: InputBoxProps) {
  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto max-w-3xl">
        <ChatInput
          onSend={onSend}
          onAbort={onAbort}
          isBusy={isBusy}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
