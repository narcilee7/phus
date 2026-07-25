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

export interface SessionItem {
  id: string;
  title: string;
  status: string;
  lastTurnAt?: number;
}

export interface SkillItem {
  name: string;
  description: string;
  source?: string;
}

export interface PlanItem {
  id: string;
  sessionId: string;
  goal: string;
  status: string;
  stepCount: number;
  updatedAt: number;
}

export interface UsePhusResult {
  messages: ChatMessage[];
  status: AgentMessageChunk["status"];
  modelLabel: string;
  isBusy: boolean;
  sessions: SessionItem[];
  skills: SkillItem[];
  plans: PlanItem[];
  isLoadingSessions: boolean;
  isLoadingSkills: boolean;
  isLoadingPlans: boolean;
  currentSessionId?: string;
  send: (content: string) => Promise<void>;
  abort: () => void;
  clear: () => void;
  refreshSessions: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshPlans: (sessionId?: string) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  createSession: () => Promise<void>;
}

function makeWelcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "system",
    content:
      "Welcome to **Phus Workbench**.\n\nSend a message to start a conversation. Use the sidebar to switch sessions or browse skills and plans.",
    status: "done",
  };
}

export function usePhus(): UsePhusResult {
  const [transport] = useState<PhusTransport>(() => createTransport());
  const [messages, setMessages] = useState<ChatMessage[]>([makeWelcomeMessage()]);
  const [status, setStatus] = useState<AgentMessageChunk["status"]>("disconnected");
  const [modelLabel, setModelLabel] = useState<string>("unknown");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();

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
          const tc = chunk.toolCall;
          if (!tc) break;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                toolCalls: [...(last.toolCalls ?? []), tc],
              };
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

  useEffect(() => {
    if (status !== "connected") return;
    void refreshSessions();
    void refreshSkills();
    void refreshCurrentSession();
  }, [status]);



  const send = useCallback(
    async (content: string) => {
      setMessages((prev) => {
        const first = prev[0];
        if (prev.length === 1 && first && first.id === "welcome") {
          return [
            {
              id: crypto.randomUUID(),
              role: "user",
              content,
              status: "done",
            },
          ];
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
            status: "done",
          },
        ];
      });
      await transport.send(content);
    },
    [transport],
  );

  const abort = useCallback(() => {
    transport.abort();
  }, [transport]);

  const clear = useCallback(() => {
    setMessages([makeWelcomeMessage()]);
  }, []);

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    const response = await transport.sendControl<SessionItem[]>("list_sessions");
    if (response.data) setSessions(response.data);
    setIsLoadingSessions(false);
  }, [transport]);

  const refreshSkills = useCallback(async () => {
    setIsLoadingSkills(true);
    const response = await transport.sendControl<SkillItem[]>("list_skills");
    if (response.data) setSkills(response.data);
    setIsLoadingSkills(false);
  }, [transport]);

  const refreshPlans = useCallback(
    async (sessionId?: string) => {
      setIsLoadingPlans(true);
      const response = await transport.sendControl<PlanItem[]>("list_plans", sessionId);
      if (response.data) setPlans(response.data);
      setIsLoadingPlans(false);
    },
    [transport],
  );

  const refreshCurrentSession = useCallback(async () => {
    const response = await transport.sendControl<{ id?: string }>("get_current_session");
    if (response.data?.id) {
      setCurrentSessionId(response.data.id);
      void refreshPlans(response.data.id);
    }
  }, [transport, refreshPlans]);

  const switchSession = useCallback(
    async (sessionId: string) => {
      const response = await transport.sendControl<SessionItem>("use_session", sessionId);
      if (response.data) {
        setCurrentSessionId(response.data.id);
        setMessages([makeWelcomeMessage()]);
      }
      void refreshSessions();
    },
    [transport, refreshSessions],
  );

  const createSession = useCallback(async () => {
    const response = await transport.sendControl<SessionItem>("new_session");
    if (response.data) {
      setCurrentSessionId(response.data.id);
      setMessages([makeWelcomeMessage()]);
    }
    void refreshSessions();
  }, [transport, refreshSessions]);

  const isBusy = status === "busy";

  return useMemo(
    () => ({
      messages,
      status,
      modelLabel,
      isBusy,
      sessions,
      skills,
      plans,
      isLoadingSessions,
      isLoadingSkills,
      isLoadingPlans,
      currentSessionId,
      send,
      abort,
      clear,
      refreshSessions,
      refreshSkills,
      refreshPlans,
      refreshCurrentSession,
      switchSession,
      createSession,
    }),
    [
      messages,
      status,
      modelLabel,
      isBusy,
      sessions,
      skills,
      plans,
      isLoadingSessions,
      isLoadingSkills,
      isLoadingPlans,
      currentSessionId,
      send,
      abort,
      clear,
      refreshSessions,
      refreshSkills,
      refreshPlans,
      refreshCurrentSession,
      switchSession,
      createSession,
    ],
  );
}
