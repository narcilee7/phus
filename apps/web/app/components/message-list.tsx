"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/use-phus";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isAssistant
              ? "bg-muted"
              : "border text-muted-foreground"
        }`}
      >
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="rounded bg-background/50 px-2 py-1 text-xs font-mono"
              >
                {tc.name}()
              </div>
            ))}
          </div>
        )}
        {message.status === "streaming" && (
          <span className="mt-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        )}
      </div>
    </div>
  );
}
