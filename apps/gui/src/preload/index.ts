// apps/gui/src/preload/index.ts
// contextBridge — exposes the typed `window.phus` API to the renderer.
// Schemas are validated in main; preload just forwards.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels } from "../shared/ipc-channels.js";
import type {
  AgentEventMsg,
  BootstrapStatusPayload,
  BootstrapSubmitPayload,
  MainErrorMsg,
  OutboundMsg,
  PermissionRequestPayload,
  PermissionResponsePayload,
  PlanEventMsg,
  PlanStepRequestPayload,
  ReflectRequestPayload,
  SetModelRequestPayload,
  SetThinkingRequestPayload,
  SlashRequestPayload,
  TurnRequestPayload,
  WizardShowMsg,
  EnvelopePayload,
  CheckpointRequestPayload,
} from "../shared/ipc-schema.js";

/** Wrap ipcRenderer.on and return an unsubscribe fn. We discard the event
 *  arg before forwarding so the renderer never sees Electron internals. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // ─── Turn lifecycle ──────────────────────────────────────────────────
  turn: (envelope: EnvelopePayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.Turn, envelope),

  abort: (): Promise<void> => ipcRenderer.invoke(IpcChannels.Abort),

  runSlash: (command: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.Slash, { command } satisfies SlashRequestPayload),

  // ─── Permission ──────────────────────────────────────────────────────
  resolvePermission: (response: PermissionResponsePayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.PermissionResponse, response),

  // ─── Model / thinking ────────────────────────────────────────────────
  setModel: (req: SetModelRequestPayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SetModel, req),

  setThinkingLevel: (req: SetThinkingRequestPayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SetThinkingLevel, req),

  // ─── Skills / conversation / checkpoints ─────────────────────────────
  reloadSkills: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ReloadSkills),
  clearConversation: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ClearConversation),
  compactSession: (): Promise<string> => ipcRenderer.invoke(IpcChannels.CompactSession),
  listCheckpoints: (sessionId: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IpcChannels.ListCheckpoints, { sessionId } satisfies CheckpointRequestPayload),
  saveCheckpoint: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.SaveCheckpoint, { sessionId } satisfies CheckpointRequestPayload),
  restoreCheckpoint: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.RestoreCheckpoint, { sessionId } satisfies CheckpointRequestPayload),

  // ─── Plan control ────────────────────────────────────────────────────
  pausePlan: (): Promise<string | undefined> => ipcRenderer.invoke(IpcChannels.PausePlan),
  resumePlan: (): Promise<string | undefined> => ipcRenderer.invoke(IpcChannels.ResumePlan),
  cancelPlan: (): Promise<string | undefined> => ipcRenderer.invoke(IpcChannels.CancelPlan),
  retryPlanStep: (planId: string, stepId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.RetryPlanStep, { planId, stepId } satisfies PlanStepRequestPayload),

  // ─── Skill drafts ────────────────────────────────────────────────────
  promoteSkillDraft: (name: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.PromoteSkillDraft, name),
  archiveSkillDraft: (name: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.ArchiveSkillDraft, name),

  // ─── Reflect ─────────────────────────────────────────────────────────
  reflect: (sessionId: string, task: string): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannels.Reflect, { sessionId, task } satisfies ReflectRequestPayload),

  // ─── Read-side snapshots ─────────────────────────────────────────────
  getBootstrapStatus: (): Promise<BootstrapStatusPayload> =>
    ipcRenderer.invoke(IpcChannels.GetBootstrapStatus),
  getDiagnostics: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.GetDiagnostics),
  getHookReport: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.GetHookReport),
  getAllSkills: (): Promise<unknown[]> => ipcRenderer.invoke(IpcChannels.GetAllSkills),
  getPolicy: (): Promise<unknown[]> => ipcRenderer.invoke(IpcChannels.GetPolicy),
  getTapeStats: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.GetTapeStats),
  getTapeSummary: (sessionId: string | undefined, limit: number): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.GetTapeSummary, { sessionId, limit }),
  getAutonomyGate: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.GetAutonomyGate),
  getMemoryStore: (): Promise<unknown> => ipcRenderer.invoke(IpcChannels.GetMemoryStore),
  getMemoryBytes: (): Promise<number> => ipcRenderer.invoke(IpcChannels.GetMemoryBytes),
  getSkillDrafts: (): Promise<unknown[]> => ipcRenderer.invoke(IpcChannels.GetSkillDrafts),
  getModelLabel: (): Promise<string> => ipcRenderer.invoke(IpcChannels.GetModelLabel),
  getThinkingLevel: (): Promise<string> => ipcRenderer.invoke(IpcChannels.GetThinkingLevel),

  // ─── Wizard / bootstrap ───────────────────────────────────────────────
  bootstrapSubmit: (payload: BootstrapSubmitPayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.BootstrapSubmit, payload),
  bootstrapCancel: (): Promise<void> => ipcRenderer.invoke(IpcChannels.BootstrapCancel),

  // ─── Push subscriptions (main → renderer) ────────────────────────────
  onAgentEvent: (cb: (msg: AgentEventMsg) => void): (() => void) =>
    subscribe<AgentEventMsg>(IpcChannels.AgentEvent, cb),
  onPlanEvent: (cb: (msg: PlanEventMsg) => void): (() => void) =>
    subscribe<PlanEventMsg>(IpcChannels.PlanEvent, cb),
  onOutbound: (cb: (msg: OutboundMsg) => void): (() => void) =>
    subscribe<OutboundMsg>(IpcChannels.Outbound, cb),
  onPermissionRequest: (cb: (req: PermissionRequestPayload) => void): (() => void) =>
    subscribe<PermissionRequestPayload>(IpcChannels.PermissionRequest, cb),
  onWizardShow: (cb: (msg: WizardShowMsg) => void): (() => void) =>
    subscribe<WizardShowMsg>(IpcChannels.WizardShow, cb),
  onWizardHide: (cb: () => void): (() => void) =>
    subscribe<void>(IpcChannels.WizardHide, () => cb()),
  onMainError: (cb: (msg: MainErrorMsg) => void): (() => void) =>
    subscribe<MainErrorMsg>(IpcChannels.Error, cb),
} as const;

export type PhusPreloadApi = typeof api;

contextBridge.exposeInMainWorld("phus", api);