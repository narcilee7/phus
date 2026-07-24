"use client";

import { usePhus } from "@/hooks/use-phus";
import { InputBox } from "./input-box";
import { MessageList } from "./message-list";

export function ChatShell() {
  const { messages, isBusy, status, modelLabel, send, abort, clear } = usePhus();

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Phus Workbench</h1>
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === "connected" ? "bg-green-500" : "bg-amber-500"
            }`}
            title={status ?? "unknown"}
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{modelLabel}</span>
          <button
            type="button"
            onClick={clear}
            className="hover:text-foreground"
          >
            Clear
          </button>
        </div>
      </header>

      <MessageList messages={messages} />

      <InputBox
        onSend={send}
        onAbort={abort}
        isBusy={isBusy}
        placeholder="Ask Phus anything…"
      />
    </div>
  );
}
