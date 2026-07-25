"use client";

import { Plus, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  ScrollArea,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@phus/phus-design";
import type { SessionItem } from "@/hooks/use-phus";

interface SessionPanelProps {
  sessions: SessionItem[];
  currentSessionId?: string;
  isLoading?: boolean;
  onRefresh: () => void;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
}

export function SessionPanel({
  sessions,
  currentSessionId,
  isLoading,
  onRefresh,
  onSelect,
  onCreate,
}: SessionPanelProps) {
  return (
    <div className="flex h-full flex-col border-r bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Sessions</h2>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh sessions</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCreate}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New session</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => {
                const active = session.id === currentSessionId;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(session.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "border-accent/30 bg-accent/10 text-accent-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="truncate font-medium">{session.title}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px]">
                          {session.status}
                        </Badge>
                        {session.lastTurnAt && (
                          <span>{new Date(session.lastTurnAt).toLocaleString()}</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
