// src/tui/handler/status-hint.ts
// Pure status hint computation. Lifted out of the render tree so the
// nesting (palette/focus/permission/sidebar/write) is declarative and
// unit-testable, instead of a six-deep ternary in the App body.

import type { PermissionRequest, PlanStepState } from "@/state/state.js";

export interface StatusHintInput {
  paletteOpen: boolean;
  focusedKind: "codeblock" | "diffreview" | "toolcall" | "subagent" | null;
  permissionQueue: PermissionRequest[];
  sidebarView: "files" | "sessions";
  /** Timestamp of the latest completed write — drives the undo flash. */
  lastWriteTs: number | undefined;
}

export function computeStatusHint(input: StatusHintInput): string | undefined {
  if (input.paletteOpen) return "↑↓ navigate · Enter select · Esc close";
  switch (input.focusedKind) {
    case "codeblock":
      return "c copy · r run · i insert · Esc input";
    case "diffreview":
      return "a accept · r reject · e edit · Esc input";
    case "toolcall":
      return "Enter/Space expand · Esc input";
    case "subagent":
      return "Esc input";
  }
  if (input.permissionQueue[0]) {
    return "Y yes · S session · A always · N no · Esc";
  }
  if (input.sidebarView === "sessions") {
    return "↑↓ navigate · Enter open · q back";
  }
  if (input.lastWriteTs) {
    return "Ctrl+Z undo · /checkpoint list";
  }
  return undefined;
}

// Re-export for convenience so consumers don't reach into state.ts for
// PlanStepState's narrow status union.
export type { PlanStepState };
