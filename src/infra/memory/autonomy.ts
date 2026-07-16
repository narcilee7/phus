// src/infra/memory/autonomy.ts
// Pure decision function for memory_write autonomy.
//
// Three modes:
//   - propose       : every action requires user approval
//   - approval-list : action.kind matching autoApprove goes through;
//                     matching requireApproval always asks; else approve
//   - yolo          : always auto, audit log only
//
// Pure functions — no I/O, no logging, no clock. Trivially testable.

import type { MemoryAction, MemoryActionKind } from "./store.js";
import type { MemoryConfig, MemoryMode } from "@/infra/config/schema.js";

export type Decision = "auto" | "approve";

/** Label used in YAML lists and audit logs. */
export function actionTag(kind: MemoryActionKind): string {
  return `memory.${kind}`;
}

/** Decide whether a `memory_write` call needs human approval.
 *
 *  `requireApproval` always wins over `autoApprove` (the deny-list
 *  overrides the allow-list even in `approval-list` mode — opt-in
 *  safety beats opt-in convenience). */
export function decide(action: MemoryAction, config: MemoryConfig): Decision {
  const tag = actionTag(action.kind);
  if (config.requireApproval.includes(tag)) return "approve";
  switch (config.mode) {
    case "yolo":
      return "auto";
    case "propose":
      return "approve";
    case "approval-list":
      return config.autoApprove.includes(tag) ? "auto" : "approve";
  }
}

/** A read-only gate — useful for the TUI's "remember always" decision
 *  to map cleanly onto an AutonomyConfig mutation. */
export class AutonomyGate {
  private constructor(private readonly _config: MemoryConfig) {}

  static fromConfig(config: MemoryConfig): AutonomyGate {
    return new AutonomyGate(config);
  }

  /** Snapshot of the underlying config — useful for diagnostics. */
  get config(): MemoryConfig {
    return this._config;
  }

  decide(action: MemoryAction): Decision {
    return decide(action, this._config);
  }

  /** True when the mode is yolo (informational; do not short-circuit
   *  the gate — `decide()` is still authoritative). */
  get isYolo(): boolean {
    return this._config.mode === ("yolo" satisfies MemoryMode);
  }
}
