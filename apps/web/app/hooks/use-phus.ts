"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createTransport } from "@/lib/transport-factory";
import type { AgentMessageChunk, PhusTransport } from "@/lib/phus-transport";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: "streaming" | "done" | "error";
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export interface UsePhusResult {
  messages: ChatMessage[];
  status: AgentMessageChunk["status"];
  modelLabel: string;
  isBusy: boolean;
  send: (content: string) => Promise<void>;
  abort: () => void;
  clear: () => void;
}

export function usePhus(): UsePhusResult {
  const [transport] = useState<PhusTransport>(() => createTransport());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content: "Welcome to Phus Workbench. Send a message to start.",
      status: "done",
    },
  ]);
  const [status, setStatus] = useState<AgentMessageChunk["status"]>("disconnected");
  const [modelLabel, setModelLabel] = useState<string>("unknown");

  useEffect(() => {
    let mounted = true;

    const unsubscribeMessage = transport.onMessage((chunk) => {
      if (!mounted) return;

      switch (chunk.type) {
        case "text": {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.status === "streaming") {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + (chunk.content ?? ""),
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: chunk.content ?? "",
                status: "streaming",
              },
            ];
          });
          break;
        }
        case "status": {
          setStatus(chunk.status ?? "idle");
          if (chunk.status === "idle") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant" && last.status === "streaming") {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, status: "done" };
                return updated;
              }
              return prev;
            });
          }
          break;
        }
        case "tool_call": {
          if (!chunk.toolCall) break;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const updated = [...prev];
              if (chunk.toolCall) {
                updated[updated.length - 1] = {
                  ...last,
                  toolCalls: [...(last.toolCalls ?? []), chunk.toolCall],
                };
              }
              return updated;
            }
            return prev;
          });
          break;
        }
        case "error": {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: chunk.error ?? "Unknown error",
              status: "error",
            },
          ]);
          break;
        }
      }
    });

    const unsubscribeStatus = transport.onStatus((next) => {
      if (mounted) setStatus(next);
    });

    void transport.getModelLabel().then((label) => {
      if (mounted) setModelLabel(label);
    });

    return () => {
      mounted = false;
      unsubscribeMessage();
      unsubscribeStatus();
      transport.close?.();
    };
  }, [transport]);

  const send = useCallback(
    async (content: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
          status: "done",
        },
      ]);
      await transport.send(content);
    },
    [transport],
  );

  const abort = useCallback(() => {
    transport.abort();
  }, [transport]);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  const isBusy = status === "busy";

  return useMemo(
    () => ({ messages, status, modelLabel, isBusy, send, abort, clear }),
    [messages, status, modelLabel, isBusy, send, abort, clear],
  );
}
