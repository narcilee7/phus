// src/tui/hooks/useAgentEvents.ts
// Subscribes to PhusAgent events and maps them into state transitions.
// Also captures file snapshots on `file_write` start so the diff review
// can show a `before → after` view.

import { useEffect, type MutableRefObject } from "react";
import { readFile } from "node:fs/promises";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { PhusAgent } from "@/bridge/pi-agent.js";
import type { AppAction } from "@/tui/state/state.js";
import { eventToAction } from "@/tui/transform/events.js";

export interface FileSnapshot {
  path: string;
  content: string;
}

export function useAgentEvents(
  agent: PhusAgent,
  dispatch: (action: AppAction) => void,
  fileSnapshotsRef: MutableRefObject<Map<string, FileSnapshot>>,
): void {
  useEffect(() => {
    const unsub = agent.subscribeToAgentEvents((event: AgentEvent) => {
      if (event.type === "tool_execution_start" && event.toolName === "file_write") {
        const path = (event.args as { path?: unknown } | undefined)?.path;
        if (typeof path === "string") {
          readFile(path, "utf-8")
            .then((content) => {
              fileSnapshotsRef.current.set(event.toolCallId, { path, content });
            })
            .catch(() => {
              fileSnapshotsRef.current.set(event.toolCallId, { path, content: "" });
            });
        }
      }
      const action = eventToAction(event as unknown as Record<string, unknown>);
      if (action) dispatch(action);
    });
    return unsub;
  }, [agent, dispatch, fileSnapshotsRef]);
}
