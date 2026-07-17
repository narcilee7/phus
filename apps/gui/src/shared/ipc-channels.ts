// apps/gui/src/shared/ipc-channels.ts
// Single source of truth for IPC channel names. Imported by main, preload,
// and renderer (renderer types are derived from the same constants).

export const IpcChannels = {
  // Renderer → Main (invoke/handle, request-response)
  Turn: "phus:turn",
  Abort: "phus:abort",
  Slash: "phus:slash",
  PermissionResponse: "phus:permission-response",
  SetModel: "phus:set-model",
  SetThinkingLevel: "phus:set-thinking-level",
  ReloadSkills: "phus:reload-skills",
  ReloadPlugins: "phus:reload-plugins",
  ClearConversation: "phus:clear-conversation",
  CompactSession: "phus:compact-session",
  ListCheckpoints: "phus:list-checkpoints",
  SaveCheckpoint: "phus:save-checkpoint",
  RestoreCheckpoint: "phus:restore-checkpoint",
  PausePlan: "phus:plan-pause",
  ResumePlan: "phus:plan-resume",
  CancelPlan: "phus:plan-cancel",
  RetryPlanStep: "phus:plan-retry-step",
  PromoteSkillDraft: "phus:promote-skill-draft",
  ArchiveSkillDraft: "phus:archive-skill-draft",
  Reflect: "phus:reflect",

  // Wizard / bootstrap
  BootstrapSubmit: "phus:bootstrap-submit",
  BootstrapCancel: "phus:bootstrap-cancel",

  // Read-side facade (invoke, returns snapshot)
  GetDiagnostics: "phus:diag",
  GetHookReport: "phus:hook-report",
  GetAllSkills: "phus:skills",
  GetPolicy: "phus:policy",
  GetTapeStats: "phus:tape-stats",
  GetTapeSummary: "phus:tape-summary",
  GetAutonomyGate: "phus:autonomy",
  GetMemoryStore: "phus:memory-store",
  GetMemoryBytes: "phus:memory-bytes",
  GetSkillDrafts: "phus:skill-drafts",
  GetModelLabel: "phus:model-label",
  GetThinkingLevel: "phus:thinking-level",
  GetBootstrapStatus: "phus:bootstrap-status",

  // Main → Renderer (push, fire-and-forget)
  AgentEvent: "agent:event",
  PlanEvent: "plan:event",
  Outbound: "outbound",
  PermissionRequest: "permission:request",
  WizardShow: "wizard:show",
  WizardHide: "wizard:hide",
  Error: "main:error",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];