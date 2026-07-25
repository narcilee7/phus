"use client";

import { useState } from "react";
import {
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@phus/phus-design";
import { usePhus } from "@/hooks/use-phus";
import { InputBox } from "./input-box";
import { MessageList } from "./message-list";
import { SessionPanel } from "./session-panel";
import { SkillPanel } from "./skill-panel";
import { PlanPanel } from "./plan-panel";

export function ChatShell() {
  const {
    messages,
    isBusy,
    status,
    modelLabel,
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
    switchSession,
    createSession,
  } = usePhus();

  const [contextOpen, setContextOpen] = useState(true);

  const connectionStatus =
    status === "busy" ? "busy" : status === "connected" ? "connected" : "disconnected";

  return (
    <div className="flex h-full w-full bg-background">
      <aside className="w-64 shrink-0">
        <SessionPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          isLoading={isLoadingSessions}
          onRefresh={refreshSessions}
          onSelect={switchSession}
          onCreate={createSession}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-sm font-semibold leading-tight">Phus Workbench</h1>
              <span className="text-xs text-muted-foreground">{modelLabel}</span>
            </div>
            <StatusBadge status={connectionStatus} />
          </div>

          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setContextOpen((v) => !v)}
                  >
                    {contextOpen ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRightOpen className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{contextOpen ? "Close side panel" : "Open side panel"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={createSession}>New session</DropdownMenuItem>
                <DropdownMenuItem onClick={refreshSessions}>Refresh sessions</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={clear} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <MessageList messages={messages} />
        <Separator />
        <InputBox onSend={send} onAbort={abort} isBusy={isBusy} />
      </main>

      {contextOpen && (
        <aside className="w-72 shrink-0 border-l bg-background">
          <Tabs defaultValue="skills" className="flex h-full flex-col">
            <TabsList className="mx-3 mt-2 w-auto">
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="plans">Plans</TabsTrigger>
            </TabsList>
            <TabsContent value="skills" className="mt-0 flex-1">
              <SkillPanel skills={skills} isLoading={isLoadingSkills} onRefresh={refreshSkills} />
            </TabsContent>
            <TabsContent value="plans" className="mt-0 flex-1">
              <PlanPanel plans={plans} isLoading={isLoadingPlans} onRefresh={() => refreshPlans(currentSessionId)} />
            </TabsContent>
          </Tabs>
        </aside>
      )}
    </div>
  );
}
