// src/tui/hooks/useToolPermissionGate.ts
// Installs the agent-wide tool permission handler. Tools in the always- /
// session-allow sets skip the prompt; memory_write additionally consults
// the autonomy gate before showing the diff preview.

import { useEffect } from "react";
import { randomUUID } from "node:crypto";
import type { PhusAgent } from "@phus/runtime/bridge/pi-agent.js";
import { DANGEROUS_TOOLS } from "@/constants.js";
import type { AppAction, AppState } from "@/state/state.js";
import { parseMemoryAction } from "@phus/runtime/infra/meta/memory-tools.js";
import {
  buildMemoryPreview,
  describeMemoryAction,
} from "@/transform/memory.js";

export function useToolPermissionGate(
  agent: PhusAgent,
  state: AppState,
  dispatch: (action: AppAction) => void,
): void {
  useEffect(() => {
    agent.setToolPermissionHandler(async (req) => {
      if (state.allowedTools.has(req.toolName)) return true;
      if (state.sessionAllowedTools.has(req.toolName)) return true;
      if (!DANGEROUS_TOOLS.has(req.toolName)) return true;

      // memory_write consults the autonomy gate before the permission bar.
      // When the gate returns "auto" (yolo mode, or approval-list with
      // matching autoApprove), the call bypasses the prompt entirely —
      // only the tape entry + log record the decision.
      if (req.toolName === "memory_write") {
        try {
          const action = parseMemoryAction((req.args as { action?: unknown })?.action);
          const gate = agent.getAutonomyGate();
          if (gate.decide(action) === "auto") return true;
        } catch {
          // Fall through to the prompt — let the user decide if the
          // action shape is malformed.
        }
      }

      return new Promise<boolean>((resolve) => {
        const preview = req.toolName === "memory_write" ? buildMemoryPreview(req.args) : undefined;
        const caption = req.toolName === "memory_write" ? describeMemoryAction(req.args) : undefined;
        dispatch({
          type: "push_permission",
          request: {
            id: randomUUID(),
            toolName: req.toolName,
            args: req.args,
            toolCallId: req.toolCallId,
            ...(preview !== undefined ? { preview } : {}),
            ...(caption !== undefined ? { caption } : {}),
            resolve,
          },
        });
      });
    });
  }, [agent, state.allowedTools, state.sessionAllowedTools, dispatch]);
}
