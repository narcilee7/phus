// apps/gui/src/shared/ipc-schema.ts
// Single source of truth for IPC message shapes. Used by:
//   - main: validates payloads on ipcMain.handle entry
//   - preload: validates payloads on ipcRenderer.invoke / on before forwarding
//   - renderer: derives types via `Static<typeof X>`
//
// We do NOT pull in the full Phus runtime types here (no @root import) —
// schemas are intentionally narrow at the IPC boundary. The renderer trusts
// AgentEvent / PlanEvent payloads as opaque discriminated unions and lets
// `events/event-to-action.ts` (ported from src/tui/events.ts) do the heavy
// lifting inside the renderer.

import { Type, type Static } from "@sinclair/typebox";

// ─── Envelope (renderer → main, sent via phus:turn) ────────────────────────

export const EnvelopeSchema = Type.Object({
  id: Type.String(),
  from: Type.String(),
  content: Type.String(),
  type: Type.Union([
    Type.Literal("text"),
    Type.Literal("image"),
    Type.Literal("reaction"),
    Type.Literal("command"),
  ]),
  channel: Type.String(),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  replyTo: Type.Optional(Type.String()),
  image: Type.Optional(
    Type.Object({ data: Type.String(), mimeType: Type.String() }),
  ),
  sessionId: Type.Optional(Type.String()),
  ts: Type.Number(),
});
export type EnvelopePayload = Static<typeof EnvelopeSchema>;

// ─── Outbound (main → renderer, broadcast on `outbound`) ──────────────────

export const OutboundSchema = Type.Object({
  to: Type.String(),
  content: Type.String(),
  type: Type.Union([
    Type.Literal("text"),
    Type.Literal("image"),
    Type.Literal("reaction"),
  ]),
  channel: Type.String(),
  replyTo: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type OutboundPayload = Static<typeof OutboundSchema>;

// ─── AgentEvent (opaque discriminated union from pi-agent-core) ───────────
//
// We intentionally keep this as Type.Any at the IPC boundary. The full union
// has 10 variants and a nested AssistantMessageEvent with 12 sub-variants —
// typing it here buys little (renderer still has to narrow with `event.type`)
// and costs a lot of schema surface area. `events/event-to-action.ts` does
// the real narrowing with type assertions.

export const AgentEventSchema = Type.Unknown();
export type AgentEventPayload = unknown;

// ─── PlanEvent (from Phus core; 11 variants) ──────────────────────────────
//
// We type the discriminant `type` so the renderer can branch cheaply, and
// leave the per-variant extras as Type.Unknown. Same trade-off as AgentEvent.

const PlanEventTypeSchema = Type.Union([
  Type.Literal("plan_step_started"),
  Type.Literal("plan_step_completed"),
  Type.Literal("plan_step_failed"),
  Type.Literal("plan_step_output"),
  Type.Literal("plan_step_retry"),
  Type.Literal("plan_subagent_started"),
  Type.Literal("plan_subagent_completed"),
  Type.Literal("plan_paused"),
  Type.Literal("plan_resumed"),
  Type.Literal("plan_cancelled"),
  Type.Literal("plan_completed"),
]);

export const PlanEventSchema = Type.Object({
  type: PlanEventTypeSchema,
  planId: Type.String(),
  sessionId: Type.String(),
  goal: Type.String(),
  planStatus: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("paused"),
    Type.Literal("completed"),
    Type.Literal("failed"),
  ]),
  step: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
  output: Type.Optional(Type.String()),
  subagent: Type.Optional(
    Type.Object({
      sessionId: Type.String(),
      label: Type.String(),
      goal: Type.String(),
    }),
  ),
  retryDelta: Type.Optional(Type.Number()),
});
export type PlanEventPayload = Static<typeof PlanEventSchema>;

// ─── Permission flow (bidirectional) ──────────────────────────────────────

export const PermissionRequestSchema = Type.Object({
  requestId: Type.String(),
  toolName: Type.String(),
  args: Type.Unknown(),
  toolCallId: Type.String(),
  preview: Type.Optional(Type.String()),
  caption: Type.Optional(Type.String()),
});
export type PermissionRequestPayload = Static<typeof PermissionRequestSchema>;

export const PermissionResponseSchema = Type.Object({
  requestId: Type.String(),
  allow: Type.Boolean(),
  scope: Type.Union([
    Type.Literal("once"),
    Type.Literal("session"),
    Type.Literal("always"),
  ]),
});
export type PermissionResponsePayload = Static<typeof PermissionResponseSchema>;

// ─── Wizard / bootstrap ───────────────────────────────────────────────────

export const BootstrapStatusSchema = Type.Object({
  needsBootstrap: Type.Boolean(),
  needsKey: Type.Boolean(),
  hasConfig: Type.Boolean(),
  profileName: Type.Optional(Type.String()),
  provider: Type.Optional(Type.String()),
  apiKeyEnv: Type.Optional(Type.String()),
  suggestedEnvVar: Type.Optional(Type.String()),
});
export type BootstrapStatusPayload = Static<typeof BootstrapStatusSchema>;

export const BootstrapSubmitSchema = Type.Object({
  profileName: Type.String(),
  provider: Type.String(),
  modelId: Type.String(),
  apiKey: Type.Optional(Type.String()),
  apiKeyMode: Type.Union([
    Type.Literal("env"),
    Type.Literal("inline"),
  ]),
});
export type BootstrapSubmitPayload = Static<typeof BootstrapSubmitSchema>;

// ─── Slash command ────────────────────────────────────────────────────────

export const SlashRequestSchema = Type.Object({
  command: Type.String(),
});
export type SlashRequestPayload = Static<typeof SlashRequestSchema>;

// ─── Turn request (renderer → main) ───────────────────────────────────────

export const TurnRequestSchema = Type.Object({
  envelope: EnvelopeSchema,
});
export type TurnRequestPayload = Static<typeof TurnRequestSchema>;

// ─── Set model / thinking level ───────────────────────────────────────────

export const SetModelRequestSchema = Type.Object({
  modelId: Type.String(),
  provider: Type.Optional(Type.String()),
});
export type SetModelRequestPayload = Static<typeof SetModelRequestSchema>;

export const SetThinkingRequestSchema = Type.Object({
  level: Type.String(),
});
export type SetThinkingRequestPayload = Static<typeof SetThinkingRequestSchema>;

// ─── Checkpoints ──────────────────────────────────────────────────────────

export const CheckpointRequestSchema = Type.Object({
  sessionId: Type.String(),
});
export type CheckpointRequestPayload = Static<typeof CheckpointRequestSchema>;

// ─── Plan control ─────────────────────────────────────────────────────────

export const PlanStepRequestSchema = Type.Object({
  planId: Type.String(),
  stepId: Type.String(),
});
export type PlanStepRequestPayload = Static<typeof PlanStepRequestSchema>;

export const ReflectRequestSchema = Type.Object({
  sessionId: Type.String(),
  task: Type.String(),
});
export type ReflectRequestPayload = Static<typeof ReflectRequestSchema>;

// ─── Broadcast message wrappers (main → renderer) ─────────────────────────

export const AgentEventMsgSchema = Type.Object({
  event: AgentEventSchema,
});
export type AgentEventMsg = Static<typeof AgentEventMsgSchema>;

export const PlanEventMsgSchema = Type.Object({
  event: PlanEventSchema,
});
export type PlanEventMsg = Static<typeof PlanEventMsgSchema>;

export const OutboundMsgSchema = Type.Object({
  outbounds: Type.Array(OutboundSchema),
});
export type OutboundMsg = Static<typeof OutboundMsgSchema>;

export const WizardShowMsgSchema = Type.Object({
  kind: Type.Union([Type.Literal("bootstrap"), Type.Literal("key")]),
  status: BootstrapStatusSchema,
});
export type WizardShowMsg = Static<typeof WizardShowMsgSchema>;

export const MainErrorMsgSchema = Type.Object({
  message: Type.String(),
  stack: Type.Optional(Type.String()),
});
export type MainErrorMsg = Static<typeof MainErrorMsgSchema>;

// ─── Read-side snapshots (main → renderer, response to invoke) ───────────
//
// We deliberately do NOT type every diagnostics / skills / hook-report shape
// here — those are pulled straight from PhusAgentFacade getters and the
// renderer uses the same TypeScript types via a shared declaration. TypeBox
// validation only runs at the boundary; inside the renderer we trust the
// snapshot shape once it has cleared main.
