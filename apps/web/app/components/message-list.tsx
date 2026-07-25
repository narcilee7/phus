"use client";

import { useEffect, useRef } from "react";
import { ChatMessage, EmptyState, ScrollArea } from "@phus/phus-design";
import type { ChatMessage as ChatMessageType } from "@/hooks/use-phus";

interface MessageListProps {
  messages: ChatMessageType[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const isStreaming = isLast && message.role === "assistant" && message.status === "streaming";
          return (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              isStreaming={isStreaming}
              toolCalls={message.toolCalls?.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments,
                state: "success",
              }))}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
