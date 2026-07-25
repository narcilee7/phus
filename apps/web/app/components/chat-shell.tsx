"use client";

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
    send,
    abort,
    clear,
    refreshSessions,
    refreshSkills,
    refreshPlans,
  } = usePhus();

  const handleSkillActivate = (name: string) => {
    void send(`Use skill: ${name}`);
  };

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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList messages={messages} />
          <InputBox
            onSend={send}
            onAbort={abort}
            isBusy={isBusy}
            placeholder="Ask Phus anything…"
          />
        </div>

        <div className="hidden w-64 shrink-0 flex-col border-l md:flex">
          <div className="flex h-1/3 flex-col border-b">
            <SessionPanel sessions={sessions} onRefresh={refreshSessions} />
          </div>
          <div className="flex h-1/3 flex-col border-b">
            <SkillPanel
              skills={skills}
              onRefresh={refreshSkills}
              onActivate={handleSkillActivate}
            />
          </div>
          <div className="flex h-1/3 flex-col">
            <PlanPanel plans={plans} onRefresh={refreshPlans} />
          </div>
        </div>
      </div>
    </div>
  );
}
