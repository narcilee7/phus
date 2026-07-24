// src/bridge/pi-agent.ts
// PhusAgent — wraps `@mariozechner/pi-agent-core`'s Agent, runs the
// Bub hook chain. Construction is now explicit: every dependency is
// injected via `PhusAgentDeps`; no module-level state.
//
// For the lifecycle wrapper (factory + dispose), see ./lifecycle.ts.

import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type AgentEvent,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
  type AfterToolCallContext,
  type AfterToolCallResult,
} from "@mariozechner/pi-agent-core";
import { streamSimple, type Model } from "@mariozechner/pi-ai";
import type { Envelope, Outbound } from "@phus/core/types/channel/index.js";
import { Planner } from '@phus/runtime/core/runtime/plan/planner.js';
import type { Plan, PlanStatus, Step, StepStatus } from "../core/runtime/plan/types.js";
import { PlanStore } from "@phus/core/session/plan-store.js";
import { createDefaultCorePort } from "./core-port-impl.js";
import type { CorePort } from "./core-port.js";
import { Learner } from "@phus/runtime/core/runtime/evolution/learner.js";
import { SkillValidator } from "@phus/core/runtime/skill/validator.js";
import { EvolutionEngine } from "@phus/runtime/core/runtime/evolution/engine.js";
import type { Turn } from "@phus/core/types/tape/index.js";
import type { MetaTool } from "@phus/runtime/types/tool.js";
import type { SessionId } from "@phus/core/types/brand.js";
import { asSessionId, asToolCallId, asTurnId } from "@phus/core/types/brand.js";
import { Tape } from "@phus/core/session/tape.js";
import { SessionTape } from "@phus/core/session/session-tape.js";
import type { SessionStore } from "@phus/core/session/session-store.js";
import type { SessionStorage } from "@phus/core/session/session-storage.js";
import { PiSteeringInbox } from "@phus/core/runtime/steering/index.js";
import { SkillRegistry } from "../infra/skills/registry.js";
import type { SkillDraft } from "../infra/skills/draft.js";
import { createMetaTools } from "../infra/meta/index.js";
import { createExternalTools } from "./tools.js";
import { defaultPolicy, evaluate, type PolicyRule } from "../infra/safety.js";
import {
  resolveProfile,
  modelFromProfile,
  apiKeyForProfile,
  getLlmFuse,
  type ProviderProfile,
} from "../infra/profile.js";
import { loadConfig } from "../infra/config/index.js";
import type { SteeringInbox } from "@phus/core/types/steering/index.js";
import { maybeCompact, type AutoCompactConfig, DEFAULT_AUTO_COMPACT } from "@phus/core/session/auto-compact.js";
import { saveCheckpoint, loadLatestCheckpoint, listCheckpoints, type CheckpointEntry } from "@phus/core/session/checkpoint.js";
import { MeshLike, ProviderMesh, type EndpointSpec, type MeshPolicy } from "../llm/provider-mesh/index.js";
import { logger } from "../infra/logging.js";
import type { ChannelAdapter } from "../channels/base.js";
import { toAgentTool } from "./agent-tool-adapter.js";
import { extractText } from "./text.js";
import { resolveApiKey } from "./model-resolver.js";
import { registerDefaultHooks } from "./default-hooks.js";
import { buildContextBlock } from "./prompt-assembly.js";
import { RepoFileIndex } from "@phus/core/session/repo-file-index.js";
import { MemoryStore, AutonomyGate } from "../infra/memory/index.js";
import { TurnReflector, DEFAULT_REFLECTOR, type ReflectorConfig } from "../infra/memory/reflector.js";
import { HookRegistry } from "@phus/core/runtime/hook/registry.js";
import { Executor } from "@phus/runtime/core/runtime/executor/index.js";
import { PlanRunner } from "@phus/runtime/core/runtime/plan/plan-runner.js";
import { makeCtx } from "@phus/core/runtime/hook/ctx-builder.js";
import type { HookContext, HookName } from "@phus/core/types/index.js";
import { SessionRuntimeRegistry } from "./session-runtime-registry.js";
import { Verifier } from "@phus/runtime/core/runtime/verifier/index.js";

export interface PhusAgentDeps {
  /** Logger used for all diagnostic and error events. */
  logger: typeof logger;
  /** The agent's persistent event log. */
  tape: Tape;
  /** Shared SQLite owner for the Session catalog + Tape (Phase 1). */
  sessionStorage?: SessionStorage;
  /** Durable Session catalog. Non-load-bearing until later migration phases. */
  sessionStore?: SessionStore;
  /** The skill registry the agent reads. */
  skills: SkillRegistry;
  /** The hook bus all Bub-style hooks flow through. */
  hooks: HookRegistry;
  /** The provider mesh used to pick an initial endpoint. */
  mesh: MeshLike;
  /** Initial operator-facing Session. Defaults to `tui:user`. */
  initialSessionId?: SessionId;
  /** Maximum idle resident Session runtimes before LRU eviction. */
  maxSessionRuntimes?: number;
  /** Creates an isolated steering inbox for each additional Session runtime. */
  steeringInboxFactory?: () => SteeringInbox;
  /** The steering inbox drained before each turn. */
  steeringInbox: SteeringInbox;
  /** The active provider profile (already resolved). */
  profile: ProviderProfile;
  /** The active safety policy. */
  policy: readonly PolicyRule[];
  /** Optional scheduler (gateway mode only). */
  scheduler?: unknown;
  /** Extra channels plugins have registered. */
  channels?: ChannelAdapter[];
  /** Project memory store (phus.md). Required for memory_read/memory_write. */
  memoryStore: MemoryStore;
  /** Autonomy gate consulted by the TUI permission handler. */
  autonomyGate: AutonomyGate;
  /** Optional repo file index — when wired, the system prompt lists the
   *  most relevant files for the current query. Defaults to cwd when omitted. */
  repoIndex?: RepoFileIndex;
  /** Override for the auto-compaction threshold. */
  autoCompact?: AutoCompactConfig;
  /** SQLite-backed plan store. If omitted, an in-memory store is used. */
  planStore?: PlanStore;
  /** Post-turn auto-reflection config. `undefined` → use defaults
   *  (off). When `autoReflect` is true, every turn runs the
   *  TurnReflector over the user prompt + assistant output + tool
   *  results; emitted actions route through the existing
   *  AutonomyGate so `yolo` / matching `autoApprove` commit them
   *  straight to phus.md. */
  reflectorConfig?: ReflectorConfig;
  /** Optional injection port for planner / verifier / learner. If
   *  omitted, PhusAgent constructs a default `CorePort` that wraps
   *  the live Pi Agent. Plugin authors and tests can substitute a
   *  mock. */
  corePort?: CorePort;
  /** Planner for long-horizon tasks. If omitted, a default planner is created. */
  planner?: Planner;
  /** Step executor used by the plan runner. If omitted, a default executor is created. */
  executor?: Executor;
  /** Plan runner orchestrating multi-step plans. If omitted, a default runner is created. */
  planRunner?: PlanRunner;
}

/** Plan lifecycle event forwarded from the plan runner to TUI observers. */
export interface PlanEvent {
  type:
    | "plan_step_started"
    | "plan_step_completed"
    | "plan_step_failed"
    | "plan_step_output"
    | "plan_step_retry"
    | "plan_subagent_started"
    | "plan_subagent_completed"
    | "plan_paused"
    | "plan_resumed"
    | "plan_cancelled"
    | "plan_completed";
  planId: string;
  sessionId: string;
  goal: string;
  planStatus: PlanStatus;
  step?: Step;
  error?: string;
  /** Optional intermediate output (plan_step_output). */
  output?: string;
  /** Subagent session metadata (plan_subagent_started). */
  subagent?: { sessionId: string; label: string; goal: string };
  /** Retry count delta (plan_step_retry). */
  retryDelta?: number;
  /** DAG level for the step. The plan-runner computes the level
   *  from `dependsOn` and threads it through every step event so
   *  the TUI can render a "LvN" badge without re-deriving the
   *  DAG from the limited PlanStepState. */
  level?: number;
}

export type PlanEventHandler = (event: PlanEvent) => void;

/** Auto-compact lifecycle event surfaced to TUI observers. Mirrors
 *  the `PlanEvent` pattern — a discriminated union the TUI maps to
 *  `add_system` chat items. */
export interface CompactEvent {
  type:
    | "context_near_limit"
    | "context_compacting"
    | "context_compacted"
    | "compact_failed";
  sessionId?: string;
  /** Fraction of input budget used (0..1). */
  ratio?: number;
  /** Token count that triggered the event (reported or estimated). */
  tokens?: number;
  /** Model's input budget = contextWindow - maxOutputTokens. */
  inputBudget?: number;
  /** Model's full context window. */
  contextWindow?: number;
  /** Number of older turns collapsed by the compact. */
  summarized?: number;
  /** Number of recent turns kept after the compact. */
  kept?: number;
  /** Anchor name written to the tape. */
  anchorName?: string;
  /** Reason text from the decision. */
  reason?: string;
  /** Error message (compact_failed only). */
  error?: string;
}

export type CompactEventHandler = (event: CompactEvent) => void;

/** Diagnostics snapshot returned by `getDiagnostics()`. */
export interface AgentDiagnostics {
  sessionId: SessionId | undefined;
  currentSessionOverride: SessionId | undefined;
  modelLabel: string;
  thinkingLevel: string;
  messageCount: number;
  tapeStats: { totalEntries: number; sessions: Record<string, number> };
  skillCount: number;
}

/**
 * Narrow public surface for PhusAgent. The TUI, CLI, and internal
 * commands depend on this interface — they should NOT reach through
 * `_internal` to access hooks / tape / skills. That access pattern
 * made the previous monolith impossible to refactor.
 *
 * Coverage is intentionally wide: every diagnostic the CLI and TUI
 * need is here. The interface IS the public API; the concrete
 * `PhusAgent` class adds lifecycle (constructor, dispose).
 */
export interface ToolPermissionRequest {
  toolName: string;
  args: unknown;
  toolCallId: string;
}

export interface PhusAgentFacade {
  // ─── Turn lifecycle ───────────────────────────────────────────
  /** Run one inbound envelope through the Bub hook chain. */
  turn(envelope: Envelope, channel: ChannelAdapter): Promise<Turn>;
  /** Abort the current turn. */
  abort(): void;
  /** Wait until the current turn completes. */
  waitForIdle(): Promise<void>;
  /** Queue a steering message (interrupts mid-run). */
  steer(message: AgentMessage): void;
  /** Queue a follow-up message (runs after current turn finishes). */
  followUp(message: AgentMessage): void;
  /** Register a callback that decides whether a tool call may proceed.
   *  Invoked after the static policy check for every tool call. */
  setToolPermissionHandler(handler: (req: ToolPermissionRequest) => Promise<boolean>): void;

  // ─── Session control ───────────────────────────────────────────
  getCurrentSessionId(): SessionId | undefined;
  setNextSessionId(id: SessionId): void;
  reloadSkills(): Promise<void>;
  clearConversation(): Promise<void>;
  compactCurrentSession(): Promise<string>;
  restoreCheckpoint(id: SessionId): Promise<void>;
  saveCheckpoint(id: SessionId): void;
  listCheckpoints(id: SessionId): CheckpointEntry[];

  // ─── Diagnostics (used by `phus hooks/skills/tape/policy/context`) ─
  /** Aggregate snapshot — what `phus context` prints. */
  getDiagnostics(): AgentDiagnostics;
  /** Hook report — what `phus hooks` prints. */
  getHookReport(): Record<string, Array<{ priority: number; mode: "first_result" | "chain" | "broadcast" }>>;
  /** All skills (name + metadata + description). */
  getAllSkills(): readonly import("@phus/core/types/skill.js").Skill[];
  /** Look up one skill by name. */
  getSkill(name: string): import("@phus/core/types/skill.js").Skill | undefined;
  /** Active safety policy rules. */
  getPolicy(): readonly PolicyRule[];
  /** Tape statistics. */
  getTapeStats(): { totalEntries: number; sessions: Record<string, number> };
  /** Replay all entries for a session (Tape-style generator). */
  replayTape(sessionId?: string): Generator<import("@phus/core/types/tape/index.js").TapeEntry>;
  /** Render a recent-turn summary (used by `,context`). */
  getTapeSummary(sessionId: SessionId | undefined, limit: number): string;

  // ─── Project memory (used by TUI permission flow + diagnostics) ─
  /** Autonomy gate for memory_write. The TUI consults this to decide
   *  whether to prompt the user or auto-approve. */
  getAutonomyGate(): AutonomyGate;
  /** Memory store (phus.md). TUI uses this for diff previews. */
  getMemoryStore(): MemoryStore;
  /** Bytes currently on disk for phus.md — surfaced in diagnostics. */
  getMemoryBytes(): number;

  // ─── Plugin loading (used by `,reload` / `,plugins`) ───────────
  /**
   * Re-discover skills + plugins from disk. Returns a summary line
   * suitable for `,reload`'s output.
   */
  reloadSkillsAndPlugins(channels: ChannelAdapter[]): Promise<{
    skills: number;
    plugins: number;
    pluginStatus: Array<{ name: string; ok: boolean; path: string }>;
  }>;

  // ─── Live status (TUI / header bar) ───────────────────────────
  /** Subscribe to Pi Agent events (returns an unsubscribe fn). */
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void;
  /** Get the active model label `{provider}/{id}`. */
  getModelLabel(): string;
  /** Get the active model's provider and id. */
  getCurrentModel(): { provider: string; id: string };
  /** Set the active model by id. The provider is inferred from the
   *  current profile or `provider` argument. */
  setModel(modelId: string, provider?: string): Promise<void>;
  /** Get current thinking level. */
  getThinkingLevel(): string;
  /** Set current thinking level. */
  setThinkingLevel(level: string): void;
  /** Number of skills currently registered. */
  getSkillCount(): number;
  /** Get the skills-to-prompt-context block (markdown list). */
  getSkillsPrompt(): string;
  /** All skill drafts. */
  getSkillDrafts(): readonly SkillDraft[];
  /** Promote a skill draft to a real skill. */
  promoteSkillDraft(name: string): boolean;
  /** Archive a skill draft. */
  archiveSkillDraft(name: string): boolean;
  /** Suggest startup.sh content based on recent tape. */
  suggestStartup(): Promise<string>;
  /** Reflect on a session and return a structured reflection. */
  reflect(sessionId: SessionId, task: string): Promise<import("@phus/runtime/core/runtime/evolution/types.js").Reflection>;
  /** Number of entries currently in tape. */
  getTapeTotalEntries(): number;
  /** Number of sessions currently in tape. */
  getSessionCount(): number;
  /** Message count in the live Pi conversation. */
  getMessageCount(): number;
  /** Number of user/assistant messages in the conversation. */
  getTurnCount(): number;
  /** Abort the current turn (alias for `abort()` for naming parity). */
  interrupt(): void;
  /** Get the underlying mesh (for diagnostic / advanced commands). */
  getMesh(): MeshLike;
  /** Get the plan runner, if one is configured. */
  getPlanRunner(): PlanRunner | undefined;
  /** Get the plan store, if one is configured. */
  getPlanStore(): PlanStore | undefined;
  /** Paused (resumable) plans across all sessions, newest first. Plans
   *  are durable citizens — interrupted ones are reconciled to `paused`
   *  at startup and surfaced here for the TUI's resume prompt. */
  getInterruptedPlans(): Plan[];
  /** Subscribe to plan lifecycle events (step started/completed/failed,
   *  plan completed). Returns an unsubscribe function. */
  subscribeToPlanEvents(handler: PlanEventHandler): () => void;
  /** Subscribe to auto-compact lifecycle events (`context_near_limit`,
   *  `context_compacting`, `context_compacted`, `compact_failed`).
   *  Returns an unsubscribe function. */
  subscribeToCompactEvents(handler: CompactEventHandler): () => void;
  /** Pause the active plan (sets plan.status to "paused" and emits the
   *  corresponding event). Returns the affected plan id, or undefined
   *  if there is no active plan. */
  pauseActivePlan(): string | undefined;
  /** Resume a paused plan by re-running it from the store. Returns the
   *  updated plan id, or undefined if no paused plan was found. */
  resumeActivePlan(): Promise<string | undefined>;
  /** Mark the active plan as cancelled. The runner does not currently
   *  support hard-aborting an in-flight turn, so this stops further
   *  step execution and tags the plan so the TUI can render it. */
  cancelActivePlan(): string | undefined;
  /** Reset a failed step back to pending and bump its retryCount. The
   *  next /plan resume picks it up. */
  retryStep(planId: string, stepId: string): boolean;
  /** Forward a subagent spawn announcement from the runtime to TUI
   *  observers. Called by SubAgent dispatching code when available. */
  notifySubagentStarted(planId: string, info: { sessionId: string; label: string; goal: string }): void;
  notifySubagentCompleted(planId: string, sessionId: string, status: "completed" | "failed"): void;
  /**
   * Re-load plugins from disk into the live HookRegistry, plus the
   * supplied channels. Returns a summary suitable for `,reload`.
   */
  loadPluginsForReload(channels: ChannelAdapter[]): Promise<{
    skills: number;
    plugins: number;
    pluginStatus: Array<{ name: string; ok: boolean; path: string }>;
  }>;
}

/**
 * PhusAgent — see {@link PhusAgentFacade} for the intended consumer
 * surface. Construction is synchronous (Pi Agent requires it). Use
 * `createPhusAgent` from `./lifecycle.ts` to also await plugin load
 * and get a paired `dispose()` for clean shutdown.
 */
interface SessionRuntimeOptions {
  sessionId: SessionId;
  registerSharedHooks?: boolean;
  reconcilePlans?: boolean;
  steeringInbox?: SteeringInbox;
}

/** One fixed Session's isolated Pi/model/plan execution state. */
export class SessionRuntime implements PhusAgentFacade {
  readonly sessionId: SessionId;
  /** Underlying Pi Agent. Internal wiring only — public consumers
   *  should use the facade methods above. */
  readonly piAgent: Agent;
  readonly tape: Tape;
  readonly sessionStorage?: SessionStorage;
  readonly sessionStore?: SessionStore;
  readonly skills: SkillRegistry;
  readonly memoryStore: MemoryStore;
  readonly autonomyGate: AutonomyGate;
  readonly repoIndex?: RepoFileIndex;
  readonly policy: readonly PolicyRule[];
  readonly profile: ProviderProfile;
  readonly mesh: MeshLike;
  /** Underlying HookRegistry. Internal wiring only — for the
   *  scheduler + plugin loader + tempHandle contexts. */
  readonly hooks: HookRegistry;
  readonly steeringInbox: SteeringInbox;
  readonly planStore: PlanStore;
  readonly planner: Planner;
  readonly executor: Executor;
  readonly planRunner: PlanRunner;
  private readonly turnReflector: TurnReflector;
  readonly learner: Learner;
  readonly evolutionEngine: EvolutionEngine;
  private currentSessionId: SessionId | undefined;
  private sessionOverride: SessionId | undefined;
  readonly extraChannels: ChannelAdapter[];
  private autoCompactCfg: AutoCompactConfig;
  private autoCompactEnabled: boolean;
  private toolPermissionHandler?: (req: ToolPermissionRequest) => Promise<boolean>;
  private planEventHandlers = new Set<PlanEventHandler>();
  private compactEventHandlers = new Set<CompactEventHandler>();
  private piEventUnsubscribe?: () => void;
  private disposed = false;
  /** CorePort — injection port for planner / verifier / learner and any
   *  other LLM-bound core consumer. Wraps the live Pi Agent loop. */
  private corePort!: CorePort;
  /** Captured at construction — plans still "running" with an older
   *  updatedAt belong to a dead process and are reconciled to paused. */
  private readonly processStartedAt = Date.now();
  /** Single AbortController that the abort() entry-point flips. The
   *  signal threads into every LLM call the runtime makes — both
   *  the parent's piAgent.prompt and the sub-agent's corePort.complete.
   *  When the TUI hits Ctrl+C, `piAgent.abort()` (which has its own
   *  internal signal) fires AND we abort this controller, so the
   *  in-flight LLM call resolves immediately instead of waiting
   *  for the full model round-trip. The controller is re-armed
   *  per turn so a later turn isn't poisoned by a stale abort. */
  private abortController: AbortController = new AbortController();

  /** API-reported input token count from the previous turn's last
   *  assistant message. Set by `handleEvent` on `turn_end`, read by
   *  `injectContext` to feed the next auto-compact decision. Reset
   *  by `rearmAbortController` at the start of each turn. */
  private lastReportedInput?: number;

  /** Build the Agent options dict used to construct BOTH the
   *  parent's piAgent and any sub-agent (via `spawnSubAgent`).
   *  Pure / no per-instance state — safe to share across the
   *  sub-agent boundary. */
  private buildAgentConfig(opts: {
    systemPrompt: string;
    tools: AgentTool[];
    sessionId: SessionId;
    model: Model<any>;
  }): ConstructorParameters<typeof Agent>[0] {
    return {
      initialState: {
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        tools: opts.tools,
        messages: [],
      },
      streamFn: async (model, context, options = {}) => {
        const fuse = getLlmFuse();
        fuse.check(`${model.provider}/${model.id}`);
        const timeoutMs = loadConfig().robustness.llmTimeoutMs;
        let response;
        try {
          response = await streamSimple(model, context, { ...options, timeoutMs });
        } catch (e) {
          fuse.report(e);
          throw e;
        }
        const gen = (async function* () {
          try {
            for await (const event of response) yield event;
          } catch (err) {
            fuse.report(err);
            throw err;
          }
        })();
        try {
          const skip = new Set(["result"]);
          for (const k of Object.keys(response as any)) {
            if (skip.has(k)) continue;
            try {
              const v = (response as any)[k];
              if (typeof v === "function") {
                (gen as any)[k] = v.bind(response);
              } else if (v === null || (typeof v !== "object" && typeof v !== "undefined")) {
                (gen as any)[k] = v;
              }
            } catch (_) {
              // ignore
            }
          }
        } catch (_) {
          // ignore
        }
        (gen as any).result = async () => {
          const r = (response as any).result;
          if (typeof r === "function") return r.call(response);
          return (response as any).extractResult
            ? (response as any).extractResult()
            : undefined;
        };
        return gen as any;
      },
      transformContext: async (messages) => this.injectContext(messages),
      beforeToolCall: async (ctx, signal) => this.beforeToolCall(ctx, signal),
      afterToolCall: async (ctx, signal) => this.afterToolCall(ctx, signal),
      getApiKey: (provider) => resolveApiKey(provider),
      onPayload: process.env.PHUS_DEBUG_WIRE
        ? (kind, payload) => this.deps.logger.debug("wire.payload", { kind, hasPayload: !!payload })
        : undefined,
      toolExecution: this.profile.toolExecution ?? "sequential",
    };
  }

  constructor(
    protected readonly deps: PhusAgentDeps,
    private readonly runtimeOptions: SessionRuntimeOptions,
  ) {
    this.sessionId = runtimeOptions.sessionId;
    this.currentSessionId = runtimeOptions.sessionId;
    this.sessionOverride = runtimeOptions.sessionId;
    this.tape = deps.tape;
    this.sessionStorage = deps.sessionStorage;
    this.sessionStore = deps.sessionStore;
    this.skills = deps.skills;
    this.memoryStore = deps.memoryStore;
    this.autonomyGate = deps.autonomyGate;
    this.repoIndex = deps.repoIndex;
    this.policy = deps.policy;
    this.profile = deps.profile;
    this.mesh = deps.mesh;
    this.hooks = deps.hooks;
    this.steeringInbox = runtimeOptions.steeringInbox ?? deps.steeringInbox;
    this.extraChannels = deps.channels ?? [];
    this.autoCompactCfg = deps.autoCompact ?? DEFAULT_AUTO_COMPACT;
    this.autoCompactEnabled = deps.profile.autoCompact !== false;

    const tools: AgentTool[] = [
      ...createMetaTools(this.skills, this.tape, {
        store: this.memoryStore,
        getCurrentSessionId: () => this.currentSessionId,
      }).map(toAgentTool),
      ...createExternalTools(),
    ];

    const initialEp = this.mesh.pickEndpoint();
    const initialModel = initialEp
      ? this.modelForEndpoint(initialEp)
      : modelFromProfile(this.profile);

    this.piAgent = new Agent(this.buildAgentConfig({
      systemPrompt: "phus:init",
      tools,
      sessionId: asSessionId(this.currentSessionId ?? "tui:user"),
      model: initialModel,
    }));

    this.piEventUnsubscribe = this.piAgent.subscribe((event) => this.handleEvent(event));
    if (runtimeOptions.registerSharedHooks !== false) {
      registerDefaultHooks(this.hooks, { tape: this.tape });
    }

    // Build the CorePort before any Planner/Verifier/Learner (they
    // each take it via deps.port). Default impl wraps the just-created
    // piAgent so the planner/verifier/learner share the same loop.
    // Callers (tests, advanced plugins) can pass a `corePort` in deps
    // to substitute a mock.
    this.corePort = deps.corePort ?? createDefaultCorePort(
      this.piAgent,
      this.piAgent.state.model,
      {
        getCurrentSessionId: () => this.currentSessionId as string | undefined,
        setNextSessionId: (id) => this.setNextSessionId(id as SessionId),
      },
    );

    this.planStore = deps.planStore ?? new PlanStore(":memory:");
    this.planner = deps.planner ?? new Planner({
      skills: this.skills,
      port: this.corePort,
      hooks: this.hooks,
    });
    const verifier = new Verifier({ port: this.corePort });
    this.executor = deps.executor ?? new Executor({ agent: this, verifier, tools: new Map() });
    this.planRunner = deps.planRunner ?? new PlanRunner({
      planner: this.planner,
      executor: this.executor,
      store: this.planStore,
      hooks: this.hooks,
    });
    this.turnReflector = new TurnReflector(deps.reflectorConfig ?? DEFAULT_REFLECTOR);

    this.learner = new Learner({
      tape: this.tape,
      skills: this.skills,
      port: this.corePort,
    });
    const skillValidator = new SkillValidator({
      planRunner: this.planRunner,
      planStore: this.planStore,
      skills: this.skills,
    });
    this.evolutionEngine = new EvolutionEngine({
      learner: this.learner,
      skillValidator,
      skills: this.skills,
      memoryStore: this.memoryStore,
      tape: this.tape,
      planStore: this.planStore,
    });
    this.planRunner.setEvolutionEngine(this.evolutionEngine);

    if (runtimeOptions.registerSharedHooks !== false) {
      // Forward plan runner hook events to TUI observers.
    this.hooks.register(
      "plan_step_started",
      async (ctx) => {
        const plan = ctx.extras?.plan as Plan | undefined;
        const step = ctx.extras?.step as Step | undefined;
        if (plan && step) {
          this.emitPlanEvent({
            type: "plan_step_started",
            planId: plan.id,
            sessionId: plan.sessionId,
            goal: plan.goal,
            planStatus: plan.status,
            step,
          });
        }
        return ctx;
      },
      { mode: "broadcast", priority: -100 },
    );
    this.hooks.register(
      "plan_step_completed",
      async (ctx) => {
        const plan = ctx.extras?.plan as Plan | undefined;
        const step = ctx.extras?.step as Step | undefined;
        if (plan && step) {
          this.emitPlanEvent({
            type: "plan_step_completed",
            planId: plan.id,
            sessionId: plan.sessionId,
            goal: plan.goal,
            planStatus: plan.status,
            step,
          });
        }
        return ctx;
      },
      { mode: "broadcast", priority: -100 },
    );
    this.hooks.register(
      "plan_step_failed",
      async (ctx) => {
        const plan = ctx.extras?.plan as Plan | undefined;
        const step = ctx.extras?.step as Step | undefined;
        const error = ctx.extras?.error;
        if (plan && step) {
          this.emitPlanEvent({
            type: "plan_step_failed",
            planId: plan.id,
            sessionId: plan.sessionId,
            goal: plan.goal,
            planStatus: plan.status,
            step,
            error: typeof error === "string" ? error : undefined,
          });
        }
        return ctx;
      },
      { mode: "broadcast", priority: -100 },
    );
    this.hooks.register(
      "plan_completed",
      async (ctx) => {
        const plan = ctx.extras?.plan as Plan | undefined;
        if (plan) {
          this.emitPlanEvent({
            type: "plan_completed",
            planId: plan.id,
            sessionId: plan.sessionId,
            goal: plan.goal,
            planStatus: plan.status,
          });
        }
        return ctx;
      },
      { mode: "broadcast", priority: -100 },
    );
    }

    this.piAgent.state.tools = [
      ...createMetaTools(this.skills, this.tape, {
        store: this.memoryStore,
        getCurrentSessionId: () => this.currentSessionId,
      }, {
        runner: this.planRunner,
        store: this.planStore,
        getCurrentSessionId: () => this.currentSessionId,
      }, {
        learner: this.learner,
        evolutionEngine: this.evolutionEngine,
      }).map(toAgentTool),
      ...createExternalTools(),
    ];

    if (runtimeOptions.reconcilePlans !== false) this.reconcileInterruptedPlans();

    const checkpoint = this.getSessionTape(this.currentSessionId)?.loadLatestCheckpoint()
      ?? loadLatestCheckpoint(this.tape, this.currentSessionId);
    if (checkpoint) this.piAgent.state.messages = checkpoint.messages as AgentMessage[];
  }

  /**
   * Plans are durable citizens: a plan left "running" by a dead process
   * (crash, kill, Ctrl+C before the runner settled) is not lost — but it
   * must not look alive either. Reconcile it to `paused` so the startup
   * prompt can offer an explicit resume. Single-writer assumption: two
   * live processes sharing one PHUS_HOME would flap each other's plans.
   */
  private reconcileInterruptedPlans(): void {
    try {
      const orphans = this.planStore.loadInterrupted(this.processStartedAt);
      for (const plan of orphans) {
        plan.status = "paused";
        plan.updatedAt = Date.now();
        this.planStore.save(plan);
        logger.info("plan.reconciled_interrupted", {
          planId: plan.id,
          sessionId: plan.sessionId,
          goal: plan.goal,
        });
      }
    } catch (err) {
      logger.warn("plan.reconcile_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Paused (resumable) plans across all sessions, newest first — the
   *  startup prompt's data source. */
  getInterruptedPlans(): Plan[] {
    try {
      return this.planStore.loadPaused();
    } catch {
      return [];
    }
  }

  private modelForEndpoint(ep: ReturnType<MeshLike["pickEndpoint"]>): Model<any> {
    if (!ep) return modelFromProfile(this.profile);
    const baseModel = modelFromProfile({
      ...this.profile,
      name: this.profile.name,
      provider: ep.spec.provider,
      modelId: ep.spec.modelId,
    });
    if (ep.spec.baseUrl) baseModel.baseUrl = ep.spec.baseUrl;
    if (ep.spec.modelId) baseModel.id = ep.spec.modelId;
    return baseModel;
  }

  /** Inject skills + tape summary into the system prompt on every LLM call. */
  private async injectContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    if (this.currentSessionId && this.autoCompactEnabled) {
      const cw = this.piAgent.state.model.contextWindow;
      try {
        const sessionTape = this.getSessionTape(this.currentSessionId);
        const compactArgs = {
          messages: this.piAgent.state.messages,
          contextWindow: cw,
          cfg: this.autoCompactCfg,
          maxOutputTokens: this.piAgent.state.model.maxTokens,
          systemPrompt: this.piAgent.state.systemPrompt,
          tools: this.piAgent.state.tools,
          lastReportedInput: this.lastReportedInput,
          logger: this.deps.logger,
        };
        const decision = sessionTape
          ? await sessionTape.maybeCompact(compactArgs)
          : await maybeCompact({
            ...compactArgs,
            tape: this.tape,
            sessionId: this.currentSessionId,
          });
        if (decision.tier === "near_limit") {
          this.deps.logger.info("context.near_limit", {
            sessionId: this.currentSessionId,
            tier: decision.tier,
            ratio: decision.snapshot.ratio,
            tokens: decision.snapshot.total,
            contextWindow: decision.snapshot.contextWindow,
            inputBudget: decision.snapshot.inputBudget,
          });
          this.emitCompactEvent({
            type: "context_near_limit",
            sessionId: this.currentSessionId,
            ratio: decision.snapshot.ratio,
            tokens: decision.snapshot.total,
            contextWindow: decision.snapshot.contextWindow,
            inputBudget: decision.snapshot.inputBudget,
          });
        }
        if (decision.fired && decision.trimmedMessages && decision.trimmedMessages.length > 0) {
          this.emitCompactEvent({
            type: "context_compacting",
            sessionId: this.currentSessionId,
            ratio: decision.snapshot.ratio,
            tokens: decision.snapshot.total,
            contextWindow: decision.snapshot.contextWindow,
            inputBudget: decision.snapshot.inputBudget,
            summarized: decision.summarized,
            kept: decision.kept,
            anchorName: decision.anchorName,
            reason: decision.reason,
          });
          // Apply the trim to the live state. This is the only writer
          // that must run before the next LLM call — both the return
          // value (Pi's `transformContext`) and `state.messages` (state
          // for subsequent turns) need to reflect the trim.
          this.piAgent.state.messages = decision.trimmedMessages as AgentMessage[];
          this.emitCompactEvent({
            type: "context_compacted",
            sessionId: this.currentSessionId,
            summarized: decision.summarized,
            kept: decision.kept,
            anchorName: decision.anchorName,
          });
          return decision.trimmedMessages as AgentMessage[];
        }
      } catch (err) {
        // `transformContext` must never throw — fall back to the
        // original messages and let the LLM call proceed.
        const error = err instanceof Error ? err.message : String(err);
        this.deps.logger.warn("compact.failed", {
          sessionId: this.currentSessionId,
          error,
        });
        this.emitCompactEvent({
          type: "compact_failed",
          sessionId: this.currentSessionId,
          error,
        });
      }
    }
    return buildContextBlock(messages, {
      hooks: this.hooks,
      tape: this.tape,
      skills: this.skills,
      memory: this.memoryStore,
      getContextWindow: () => this.piAgent.state.model.contextWindow,
      getCurrentSessionId: () => this.currentSessionId,
      getSessionTape: (id) => this.getSessionTape(id),
      setSystemPrompt: (prompt) => { this.piAgent.state.systemPrompt = prompt; },
      repoIndex: this.repoIndex,
    });
  }

  /** Pi event handler — forwards turn_end to the after_llm_call hook
   *  and captures the API-reported input token count for the next
   *  auto-compact decision. */
  private handleEvent(event: AgentEvent): void {
    if (event.type === "turn_end" && event.message?.role === "assistant") {
      const last = event.message as any;
      // Stash the real input token count so the next `injectContext`
      // can use a precise budget instead of the char/4 heuristic.
      // Includes cacheRead so cache-prefixed prompts count their
      // first-time contribution too.
      const usage = last.usage as { input?: number; cacheRead?: number } | undefined;
      if (usage && typeof usage.input === "number") {
        this.lastReportedInput = (usage.input ?? 0) + (usage.cacheRead ?? 0);
      }
      void this.hooks.execute(
        "after_llm_call",
        makeCtx({
          sessionId: this.currentSessionId,
          state: {},
          tape: this.tape,
          skills: this.skills,
          extras: {
            stopReason: last.stopReason,
            errorMessage: last.errorMessage,
            usage: last.usage,
          },
        }),
        "broadcast",
      );
    }
  }

  /** Throw a friendly error if the active profile has no API key. */
  assertModelReady(): void {
    const key = apiKeyForProfile(this.profile);
    if (key) return;

    const envVar = this.profile.apiKeyEnv
      ? this.profile.apiKeyEnv
      : `${this.profile.provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
    throw new Error(
      `No API key configured for profile "${this.profile.name}".\n` +
        `Run \`phus setup\` to configure a provider and key, or set:\n` +
        `  export ${envVar}=<your-key>`,
    );
  }

  /** Run a one-shot LLM call on behalf of a sub-agent. The
   *  implementation uses `corePort.complete` (not `piAgent.prompt`)
   *  for two reasons:
   *    1. The parent's piAgent is already busy with the user turn
   *       that triggered this sub-task. Calling piAgent.prompt()
   *       recursively is undefined behavior — pi-agent-core holds
   *       a single `currentRun` slot and the second call would
   *       either throw or silently corrupt the parent's state.
   *    2. We need the AbortSignal plumbed through, which
   *       corePort.complete forwards to `completeSimple`'s underlying
   *       fetch. piAgent.prompt uses its own internal signal
   *       that we can't directly control.
   *  The returned `AgentMessage[]` is synthesized (a user turn
   *  + the assistant reply) so the SubAgent extraction logic
   *  (looking for the last assistant message) works unchanged. */
  async runTurn(
    sessionId: SessionId,
    taskText: string,
    signal?: AbortSignal,
  ): Promise<AgentMessage[]> {
    this.assertModelReady();
    // Honor the caller's explicit signal, but always also tie the
    // call to the runtime-level AbortController so a global
    // `PhusAgent.abort()` reaches this in-flight call. The combined
    // signal aborts on either source firing.
    const effectiveSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal;
    void sessionId;
    const completion = await this.corePort.complete(
      [{ role: "user", content: taskText }],
      effectiveSignal,
    );
    const ts = Date.now();
    return [
      {
        role: "user",
        content: [{ type: "text", text: taskText }],
        timestamp: ts,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: completion.text }],
        timestamp: ts + 1,
      } as AgentMessage,
    ];
  }

  /** Run one inbound envelope through the Bub hook chain. */
  async turn(envelope: Envelope, channel: ChannelAdapter): Promise<Turn> {
    this.assertModelReady();
    // Re-arm the runtime-level AbortController so a Ctrl+C in the
    // previous turn doesn't poison this turn. The previous turn's
    // signal was already aborted by `abort()` (or the turn ran to
    // completion, in which case the controller is still fresh).
    this.rearmAbortController();
    const startedAt = Date.now();
    const sessionId = this.currentSessionId;
    if (!sessionId) throw new Error("SessionRuntime requires a fixed session id");
    if (envelope.sessionId && envelope.sessionId !== sessionId) {
      throw new Error(
        `SessionRuntime ${sessionId} cannot process envelope for ${envelope.sessionId}`,
      );
    }
    envelope.sessionId = sessionId;
    this.piAgent.sessionId = sessionId;

    // Runaway guards: reset the per-turn LLM call counter, fail fast
    // when the billing fuse is open (zero requests sent), and arm the
    // wall-clock watchdog — pi-agent-core's loop is `while(true)` with
    // no iteration cap, so this timer is the hard upper bound.
    const fuse = getLlmFuse();
    fuse.resetTurn();
    fuse.check("turn");
    const watchdogMs = loadConfig().robustness.turnTimeoutMs;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    if (watchdogMs > 0) {
      watchdog = setTimeout(() => {
        logger.warn("turn.watchdog_fired", { sessionId, timeoutMs: watchdogMs });
        this.abort();
      }, watchdogMs);
      // Never keep the process alive for a watchdog.
      watchdog.unref?.();
    }

    try {
      // 1. Session identity was resolved by the outer PhusAgent router.

      // 1a. Drain steering inbox
      const pending = await this.steeringInbox.drainMessages();
      for (const env of pending) {
        this.piAgent.steer({
          role: "user",
          content: [{ type: "text", text: env.content }],
          timestamp: env.ts,
        });
        logger.info("steering.injected", { from: env.from, sessionId });
      }

      // 1b. admit_message
      const admitDecision = (await this.hooks.execute<{ admit?: boolean; reason?: string }>(
        "admit_message",
        makeCtx({ envelope, sessionId, state: {}, tape: this.tape, skills: this.skills }),
        "first_result",
      )) ?? { admit: true };
      if (!admitDecision.admit) {
        logger.info("turn.rejected", { sessionId, reason: admitDecision.reason });
        throw new Error(`Message not admitted: ${admitDecision.reason ?? "(no reason)"}`);
      }

      // 2. load_state (broadcast → merge)
      const state = (await this.hooks.execute<HookContext[]>(
        "load_state",
        makeCtx({ envelope, sessionId, state: {}, tape: this.tape, skills: this.skills }),
        "broadcast",
      )) ?? [];
      const mergedState: Record<string, unknown> = {};
      for (const partial of state) {
        if (partial && typeof partial === "object") {
          Object.assign(mergedState, (partial as HookContext).state ?? partial);
        }
      }

      // 3. build_prompt — let plugins observe/transform
      const userMsg: AgentMessage = envelope.image
        ? {
          role: "user",
          content: [
            { type: "text", text: envelope.content || "(image attached)" },
            { type: "image", data: envelope.image.data, mimeType: envelope.image.mimeType },
          ],
          timestamp: envelope.ts,
        }
        : {
          role: "user",
          content: [{ type: "text", text: envelope.content }],
          timestamp: envelope.ts,
        };
      await this.hooks.execute(
        "build_prompt",
        makeCtx({
          envelope,
          sessionId,
          state: mergedState,
          tape: this.tape,
          skills: this.skills,
          extras: { userMessage: userMsg },
        }),
        "first_result",
      );

      // 4. Long-horizon plan flow OR normal Pi agent loop
      let modelOutput: string;
      const planSummary = await this.runPlanFlowIfRequested(envelope, sessionId);
      if (planSummary !== undefined) {
        modelOutput = planSummary;
      } else {
        await this.piAgent.prompt(userMsg);
        const lastAssistant = [...this.piAgent.state.messages]
          .toReversed()
          .find((m) => m.role === "assistant");
        modelOutput = extractText(lastAssistant);
      }

      // If the model produced no text (only tool calls, or a streaming
      // provider that yielded zero text deltas), surface a visible
      // placeholder rather than a blank assistant item. The TUI relies
      // on `channel.send()` text to render a final response when
      // streaming was empty, and an empty string there means the user
      // sees nothing for the turn. The placeholder lets the channel
      // adapter round-trip a system note.
      const modelProducedText = modelOutput.trim().length > 0;
      if (!modelProducedText) {
        const toolCalls = this.collectToolCalls();
        // Two distinct cases — text-shape matters for the user's
        // mental model:
        //   (a) model ran tool(s) but produced no final assistant text
        //       → the run is "structurally complete", just terse
        //   (b) model produced neither tool calls nor text
        //       → almost certainly a provider-side streaming error
        //         (e.g. "response.result is not a function" mid-stream)
        const toolSummary = toolCalls.length
          ? `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}, no final text`
          : "no final text and no tool calls (likely a streaming error)";
        modelOutput = `*[${toolSummary}]*`;
        logger.warn("turn.empty_model_output", {
          sessionId,
          toolCallCount: toolCalls.length,
        });
      }

      // 6. render_outbound (broadcast → merge)
      const outbounds = (await this.hooks.execute<Outbound[]>(
        "render_outbound",
        makeCtx({
          envelope,
          sessionId,
          state: mergedState,
          tape: this.tape,
          skills: this.skills,
          extras: { modelOutput },
        }),
        "broadcast",
      )) ?? [];

      const finalOutbounds: Outbound[] = outbounds.length > 0
        ? outbounds
        : [
          {
            to: String((envelope.metadata as any).chatId ?? envelope.from),
            content: modelOutput,
            type: "text",
            channel: envelope.channel,
            replyTo: envelope.replyTo,
          },
        ];

      // 7. dispatch_outbound
      await channel.send(finalOutbounds);

      // 8. save_state
      await this.hooks.execute(
        "save_state",
        makeCtx({
          envelope,
          sessionId,
          state: mergedState,
          tape: this.tape,
          skills: this.skills,
          extras: { modelOutput, outbounds: finalOutbounds },
        }),
        "broadcast",
      );

      // 9. Record turn to Tape
      const turn: Turn = {
        id: asTurnId(crypto.randomUUID()),
        ts: startedAt,
        sessionId: sessionId as SessionId,
        inbound: envelope,
        prompt: envelope.content,
        modelOutput,
        toolCalls: this.collectToolCalls(),
        outbound: finalOutbounds,
        durationMs: Date.now() - startedAt,
      };
      const sessionTape = this.getSessionTape(sessionId);
      if (sessionTape) sessionTape.append({ kind: "turn", turn });
      else this.tape.append({ kind: "turn", turn });

      // 10. Per-turn checkpoint — exactly one snapshot per turn, keyed
      // by the turn's own id (not the last toolCallId). Replaces the
      // per-tool-call checkpoint that previously lived in
      // `afterToolCall` and inflated the tape.
      try {
        if (sessionTape) {
          sessionTape.saveCheckpoint(this.piAgent.state.messages, turn.id);
        } else {
          saveCheckpoint(
            this.tape,
            this.currentSessionId as SessionId,
            this.piAgent.state.messages,
            turn.id,
          );
        }
      } catch (err: any) {
        logger.warn("checkpoint.save_failed", { error: err.message });
      }

      // 11. Post-turn auto-reflection — if enabled, run the heuristic
      // reflector over the just-committed turn and route the emitted
      // actions through AutonomyGate. `yolo` and matching
      // `autoApprove` rules commit them to phus.md; everything else
      // is dropped (operators can re-run `self_reflect` to inspect
      // what the reflector saw, or call `memory_write` manually).
      // Runs only on the success path so a failed turn doesn't
      // pollute memory with half-baked text.
      try {
        this.runPostTurnReflection(turn);
      } catch (err: any) {
        logger.warn("turn.reflect_failed", { error: err?.message ?? String(err) });
      }

      logger.info("turn.completed", {
        sessionId,
        durationMs: turn.durationMs,
        toolCallCount: turn.toolCalls.length,
        outboundCount: finalOutbounds.length,
      });

      return turn;
    } catch (err: any) {
      // Classify LLM failures into the fuse (402 opens the billing
      // fuse; 429 is logged). Non-LLM errors are ignored by report().
      fuse.report(err);
      await this.hooks.execute(
        "on_error",
        makeCtx({
          envelope,
          sessionId,
          state: {},
          tape: this.tape,
          skills: this.skills,
          extras: { stage: "turn", error: err.message ?? String(err) },
        }),
        "broadcast",
      );
      logger.error("turn.failed", { sessionId, stage: "turn", error: err.message });
      throw err;
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }

  private async runPlanFlowIfRequested(
    envelope: Envelope,
    sessionId: SessionId,
  ): Promise<string | undefined> {
    if (!this.planRunner || !this.planStore) return undefined;
    const content = (envelope.content ?? "").trim();
    if (!content) return undefined;

    try {
      // Explicit /plan command: strip prefix and create+run a new plan.
      const planPrefix = "/plan ";
      if (content.startsWith(planPrefix)) {
        const goal = content.slice(planPrefix.length).trim();
        if (!goal) return undefined;
        const plan = await this.planRunner.createAndRun(goal, sessionId, envelope.content);
        return this.summarizePlan(plan);
      }

      // NOTE: plans are durable citizens driven by EXPLICIT intent only —
      // /plan commands and the plan_create/plan_run meta tools. No
      // heuristics here: an active plan must never resume just because a
      // message arrived (a bare "你好" used to resurrect stale plans),
      // and conversational text must not silently spawn plans either.
    } catch (err: any) {
      logger.error("turn.plan_flow_failed", { sessionId, error: err.message });
    }

    return undefined;
  }

  private summarizePlan(plan: Plan): string {
    const lines = [
      `Plan ${plan.id} (${plan.status}): ${plan.goal}`,
      ...plan.steps.map(
        (s) => `  ${s.index + 1}. [${s.status}] ${s.description}${s.tool ? ` (tool: ${s.tool})` : ""}`,
      ),
    ];
    return lines.join("\n");
  }

  private getSessionTape(sessionId: SessionId | undefined): SessionTape | undefined {
    if (!sessionId || !this.sessionStorage || !this.sessionStore) return undefined;
    return new SessionTape({
      sessionId,
      storage: this.sessionStorage,
      tape: this.tape,
      sessionStore: this.sessionStore,
    });
  }

  protected fallbackSession(envelope: Envelope): string {
    return `${envelope.channel || "cli"}:${(envelope.metadata as any)?.chatId ?? envelope.from ?? "default"}`;
  }

  /** Write tool_call entries to Tape before the tool runs. */
  private async beforeToolCall(
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    if (!this.currentSessionId) return undefined;

    const decision = evaluate([...this.policy], {
      toolName: ctx.toolCall.name,
      args: (ctx.args as Record<string, unknown>) ?? {},
      cwd: process.cwd(),
    });
    if (!decision.allow) {
      logger.warn("tool.blocked_by_policy", {
        sessionId: this.currentSessionId,
        tool: ctx.toolCall.name,
        reason: decision.reason,
      });
      return { block: true, reason: decision.reason };
    }

    if (this.toolPermissionHandler) {
      const allowed = await this.toolPermissionHandler({
        toolName: ctx.toolCall.name,
        args: ctx.args,
        toolCallId: ctx.toolCall.id,
      });
      if (!allowed) {
        logger.warn("tool.denied_by_user", {
          sessionId: this.currentSessionId,
          tool: ctx.toolCall.name,
        });
        return { block: true, reason: "denied by user" };
      }
    }

    logger.debug("tool.call", {
      sessionId: this.currentSessionId,
      tool: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
    });

    const entry = {
      kind: "tool_call" as const,
      sessionId: this.currentSessionId,
      toolCallId: asToolCallId(ctx.toolCall.id),
      name: ctx.toolCall.name,
      args: ctx.args,
      ts: Date.now(),
    };
    const sessionTape = this.getSessionTape(this.currentSessionId);
    if (sessionTape) sessionTape.append(entry);
    else this.tape.append(entry);
    return undefined;
  }

  private async afterToolCall(
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> {
    if (!this.currentSessionId) return undefined;
    const entry = {
      kind: "tool_result" as const,
      sessionId: this.currentSessionId,
      toolCallId: asToolCallId(ctx.toolCall.id),
      result: ctx.result,
      isError: ctx.isError,
      ts: Date.now(),
    };
    const sessionTape = this.getSessionTape(this.currentSessionId);
    if (sessionTape) sessionTape.append(entry);
    else this.tape.append(entry);
    // Checkpoint is saved ONCE per turn (in `turn()`), not on every tool
    // call. Writing on every tool call inflated the tape with full
    // message snapshots per tool — a single tool-using turn of 5 calls
    // produced 5 duplicate checkpoint rows. The turn-level checkpoint
    // covers crash recovery just as well and keeps tape size bounded.
    return undefined;
  }

  private collectToolCalls(): Turn["toolCalls"] {
    const out: Turn["toolCalls"] = [];
    for (const msg of this.piAgent.state.messages) {
      if (msg.role !== "toolResult") continue;
      const matched = this.piAgent.state.messages
        .find((m) => m.role === "assistant")
        ?.content?.find?.((c: any) => c.type === "toolCall" && c.id === msg.toolCallId) as any;
      out.push({
        name: msg.toolName,
        args: matched?.arguments,
        result: msg.details,
        isError: msg.isError,
      });
    }
    return out;
  }

  /** Heuristic post-turn reflection — no LLM call, no I/O outside
   *  the memory store. Emitted actions go through the existing
   *  AutonomyGate so `yolo` and matching `autoApprove` commit them
   *  silently; everything else is logged to tape for /tape inspection
   *  but not applied. */
  private runPostTurnReflection(turn: Turn): void {
    const { actions, reasons } = this.turnReflector.reflect(turn);
    if (actions.length === 0) return;
    let applied = 0;
    let skipped = 0;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const reason = reasons[i] ?? "unknown";
      const decision = this.autonomyGate.decide(action);
      if (decision !== "auto") {
        skipped++;
        continue;
      }
      const result = this.memoryStore.apply(action);
      if (!result.ok) {
        logger.warn("turn.reflect_apply_failed", {
          reason: result.reason,
          source: reason,
        });
        continue;
      }
      applied++;
      logger.info("turn.reflect_applied", {
        section: "section" in action ? action.section : "(n/a)",
        kind: action.kind,
        source: reason,
      });
    }
    if (applied > 0 || skipped > 0) {
      logger.info("turn.reflect_summary", {
        applied,
        skipped,
        total: actions.length,
      });
    }
  }

  // ─── PhusAgentFacade ─────────────────────────────────────────

  abort(): void {
    this.piAgent.abort();
    // Trip the runtime-level AbortController so the sub-agent's
    // in-flight LLM call (running through corePort.complete, which
    // does NOT use the piAgent's internal signal) also stops.
    // Without this, a sub-agent generation keeps streaming for the
    // full model round-trip after the user hit Ctrl+C — exactly the
    // "5-10 seconds of phantom work after the status went paused"
    // symptom.
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    // A plan run (plan_create / /plan / active-plan resume) executes
    // outside the Pi loop — piAgent.abort() alone leaves it running and
    // the turn looks hung. Cooperative: stops after the current step.
    this.planRunner?.abort();
    // Force-mark the active plan as paused right now so the TUI
    // panel + /resume picker both see the new state immediately
    // instead of waiting for the in-flight LLM call to settle.
    this.pauseActivePlan();
    logger.info("turn.aborted");
  }

  /** Re-arm the abort controller for a fresh turn. Called at the
   *  start of `turn()` so a fresh turn is never born aborted by a
   *  previous turn's Ctrl+C. */
  private rearmAbortController(): void {
    this.abortController = new AbortController();
    // The previous turn's API-reported input token count is no longer
    // trustworthy for the next round — unset it. The next LLM call
    // will re-populate from `handleEvent` on `turn_end`.
    this.lastReportedInput = undefined;
  }

  /** Public accessor for the runtime-level abort signal. The sub-agent
   *  pipeline reads this and passes it to corePort.complete, which
   *  forwards it to streamSimple. piAgent.abort() flips this same
   *  controller (see `abort()`), so a single Ctrl+C reaches both
   *  the parent's prompt and the sub-agent's LLM call. */
  getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Tool list (external + meta). Exposed so the SubAgent can run
   *  a fresh Agent with the same tool surface as the parent — its
   *  tool calls don't pollute the parent's history because they go
   *  to a separate Agent with a private `messages` array. */
  getTools(): AgentTool[] {
    return [...this.piAgent.state.tools];
  }

  /** The current model + system prompt + API key, exposed so the
   *  SubAgent can construct a parallel Agent with the same setup. */
  getModel(): unknown {
    return this.piAgent.state.model;
  }

  getApiKey(provider: string): string | undefined {
    return resolveApiKey(provider);
  }

  getSystemPrompt(): string {
    return this.piAgent.state.systemPrompt;
  }

  getApiKeyEnv(): string | undefined {
    return this.profile.apiKeyEnv;
  }

  /** Build a fully-isolated Agent for a sub-agent. The returned
   *  Agent has:
   *    - private `state.messages` (caller can re-init via
   *      `state.messages = []` before each run)
   *    - its own session id (sub-agent's view of "current session")
   *    - the same model + tools + system-prompt + hooks as the parent
   *  The sub-agent's tool calls + tool results stay in its own
   *  messages array — they never bleed into the parent's history. */
  spawnSubAgent(opts: {
    systemPrompt: string;
    tools: AgentTool[];
    sessionId: SessionId;
  }): Agent {
    return new Agent(
      this.buildAgentConfig({
        systemPrompt: opts.systemPrompt,
        tools: opts.tools,
        sessionId: opts.sessionId,
        // Snapshot the parent's currently-active model. The sub-agent
        // is "frozen" on this model for the rest of its run — if
        // the user does `/model` mid-plan, the next sub-agent will
        // see the new model; in-flight ones keep going on the
        // old one.
        model: this.piAgent.state.model,
      }),
    );
  }

  async waitForIdle(): Promise<void> {
    return this.piAgent.waitForIdle();
  }

  steer(message: AgentMessage): void {
    this.piAgent.steer(message);
  }

  followUp(message: AgentMessage): void {
    this.piAgent.followUp(message);
  }

  setToolPermissionHandler(handler: (req: ToolPermissionRequest) => Promise<boolean>): void {
    this.toolPermissionHandler = handler;
  }

  getCurrentSessionId(): SessionId | undefined {
    return this.currentSessionId ?? this.sessionOverride;
  }

  setNextSessionId(id: SessionId): void {
    if (id !== this.currentSessionId) {
      throw new Error(
        `SessionRuntime ${this.currentSessionId} cannot switch to ${id}`,
      );
    }
  }

  async reloadSkills(): Promise<void> {
    this.skills.discover();
  }

  async clearConversation(): Promise<void> {
    this.piAgent.state.messages = [];
  }

  async compactCurrentSession(): Promise<string> {
    if (!this.currentSessionId) throw new Error("no current session to compact");
    const sessionTape = this.getSessionTape(this.currentSessionId);
    const result = sessionTape
      ? await sessionTape.compact({ keepRecent: 10 })
      : await (await import("@phus/core/session/compaction.js")).compactSession(
        this.tape,
        this.currentSessionId,
        { keepRecent: 10 },
      );
    return `compacted: summarized=${result.summarized}, kept=${result.keptRecent}`;
  }

  async restoreCheckpoint(id: SessionId): Promise<void> {
    if (id !== this.currentSessionId) {
      throw new Error(`SessionRuntime ${this.currentSessionId} cannot restore ${id}`);
    }
    const sessionTape = this.getSessionTape(id);
    const cp = sessionTape
      ? sessionTape.loadLatestCheckpoint()
      : loadLatestCheckpoint(this.tape, id);
    if (!cp) throw new Error(`no checkpoint for session ${id}`);
    this.piAgent.state.messages = cp.messages as any;
  }

  saveCheckpoint(id: SessionId = this.currentSessionId as SessionId): void {
    const sessionTape = this.getSessionTape(id);
    if (sessionTape) sessionTape.saveCheckpoint(this.piAgent.state.messages as unknown[]);
    else saveCheckpoint(this.tape, id, this.piAgent.state.messages as unknown[]);
  }

  listCheckpoints(id: SessionId): CheckpointEntry[] {
    return this.getSessionTape(id)?.listCheckpoints() ?? listCheckpoints(this.tape, id);
  }

  getDiagnostics(): AgentDiagnostics {
    const m = this.piAgent.state.model;
    return {
      sessionId: this.currentSessionId,
      currentSessionOverride: this.sessionOverride,
      modelLabel: `${m.provider}/${m.id}`,
      thinkingLevel: String(this.piAgent.state.thinkingLevel ?? ""),
      messageCount: this.piAgent.state.messages.length,
      tapeStats: this.tape.stats(),
      skillCount: this.skills.getAll().length,
    };
  }

  getHookReport() {
    return this.hooks.report();
  }

  getAllSkills() {
    return this.skills.getAll();
  }

  getSkill(name: string) {
    return this.skills.get(name);
  }

  getPolicy(): readonly PolicyRule[] {
    return this.policy;
  }

  getTapeStats() {
    return this.tape.stats();
  }

  *replayTape(sessionId?: string): Generator<import("@phus/core/types/tape/index.js").TapeEntry> {
    yield* this.tape.replay(sessionId);
  }

  getTapeSummary(sessionId: SessionId | undefined, limit: number): string {
    if (sessionId) {
      const sessionTape = this.getSessionTape(sessionId);
      if (sessionTape) return sessionTape.summary(limit);
    }
    return this.tape.summary((sessionId as string) ?? "default", limit);
  }

  async reloadSkillsAndPlugins(channels: ChannelAdapter[]): Promise<{
    skills: number;
    plugins: number;
    pluginStatus: Array<{ name: string; ok: boolean; path: string }>;
  }> {
    this.skills.discover();
    const { loadPlugins } = await import("../infra/plugins/loader.js");
    const loaded = loadPlugins(this.hooks, channels, { registerRuntime: () => {} });
    return {
      skills: this.skills.getAll().length,
      plugins: loaded.length,
      pluginStatus: loaded.map((p: any) => ({
        name: p.name,
        ok: p.status === "ok",
        path: p.path,
      })),
    };
  }

  // ─── TUI/live-status facade ────────────────────────────────────

  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void {
    return this.piAgent.subscribe(handler);
  }

  subscribeToPlanEvents(handler: PlanEventHandler): () => void {
    this.planEventHandlers.add(handler);
    return () => {
      this.planEventHandlers.delete(handler);
    };
  }

  subscribeToCompactEvents(handler: CompactEventHandler): () => void {
    this.compactEventHandlers.add(handler);
    return () => {
      this.compactEventHandlers.delete(handler);
    };
  }

  pauseActivePlan(): string | undefined {
    const sid = this.currentSessionId as string | undefined;
    if (!sid) return undefined;
    const store = this.planStore;
    if (!store) return undefined;
    const plan = store.loadActiveForSession(sid);
    if (!plan || plan.status !== "running") return undefined;
    plan.status = "paused";
    plan.updatedAt = Date.now();
    store.save(plan);
    this.emitPlanEvent({
      type: "plan_paused",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
    });
    return plan.id;
  }

  async resumeActivePlan(): Promise<string | undefined> {
    const sid = this.currentSessionId as string | undefined;
    if (!sid || !this.planRunner || !this.planStore) return undefined;
    const plan = this.planStore.loadActiveForSession(sid);
    if (!plan || plan.status !== "paused") return undefined;
    plan.status = "running";
    plan.updatedAt = Date.now();
    this.planStore.save(plan);
    this.emitPlanEvent({
      type: "plan_resumed",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
    });
    // Re-run synchronously; the runner is fire-and-forget so we await
    // the returned promise to keep caller bookkeeping consistent.
    try {
      const updated = await this.planRunner.runPlan(plan);
      return updated.id;
    } catch (err) {
      logger.warn("plan_resume.failed", {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return plan.id;
    }
  }

  cancelActivePlan(): string | undefined {
    const sid = this.currentSessionId as string | undefined;
    if (!sid) return undefined;
    const store = this.planStore;
    if (!store) return undefined;
    const plan = store.loadActiveForSession(sid);
    if (!plan) return undefined;
    plan.status = "failed";
    plan.updatedAt = Date.now();
    // Mark any still-running step as skipped so the TUI can render
    // the cancellation cleanly. The runner can't be hard-aborted from
    // here, but flipping the plan status prevents downstream steps
    // from being picked up on resume.
    for (const s of plan.steps) {
      if (s.status === "running" || s.status === "pending") s.status = "skipped";
    }
    store.save(plan);
    this.emitPlanEvent({
      type: "plan_cancelled",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
    });
    return plan.id;
  }

  retryStep(planId: string, stepId: string): boolean {
    const store = this.planStore;
    if (!store) return false;
    const plan = store.load(planId);
    if (!plan) return false;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step || step.status !== "failed") return false;
    step.status = "pending";
    step.retryCount = (step.retryCount ?? 0) + 1;
    step.error = undefined;
    plan.status = "paused";
    plan.updatedAt = Date.now();
    store.save(plan);
    this.emitPlanEvent({
      type: "plan_step_retry",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
      step,
      retryDelta: 1,
    });
    return true;
  }

  notifySubagentStarted(planId: string, info: { sessionId: string; label: string; goal: string }): void {
    const plan = this.planStore?.load(planId);
    if (!plan) return;
    // Attach to the active step for backwards compatibility with existing
    // step.subagentSessionId consumers.
    const running = plan.steps.find((s) => s.status === "running");
    if (running) {
      running.subagentSessionId = info.sessionId as typeof running.subagentSessionId;
      running.subagentLabel = info.label;
      this.planStore?.save(plan);
    }
    this.emitPlanEvent({
      type: "plan_subagent_started",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
      subagent: info,
      step: running,
    });
  }

  notifySubagentCompleted(planId: string, sessionId: string, status: "completed" | "failed"): void {
    const plan = this.planStore?.load(planId);
    if (!plan) return;
    this.emitPlanEvent({
      type: "plan_subagent_completed",
      planId: plan.id,
      sessionId: plan.sessionId,
      goal: plan.goal,
      planStatus: plan.status,
      subagent: { sessionId, label: "", goal: "" },
      // Reuse the step to communicate subagent completion downstream.
      step: plan.steps.find((s) => s.subagentSessionId === sessionId),
    });
    void status;
  }

  emitPlanEvent(event: PlanEvent): void {
    for (const h of this.planEventHandlers) {
      try {
        h(event);
      } catch (err) {
        logger.warn("plan_event.handler_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private emitCompactEvent(event: CompactEvent): void {
    for (const h of this.compactEventHandlers) {
      try {
        h(event);
      } catch (err) {
        logger.warn("compact_event.handler_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getModelLabel(): string {
    return `${this.piAgent.state.model.provider}/${this.piAgent.state.model.id}`;
  }

  getCurrentModel(): { provider: string; id: string } {
    return {
      provider: this.piAgent.state.model.provider,
      id: this.piAgent.state.model.id,
    };
  }

  async setModel(modelId: string, provider?: string): Promise<void> {
    // Provider resolution order: explicit arg > profile's current provider.
    const p = provider ?? this.profile.provider;
    // Delegates to the unified resolver — cached + validated at config load.
    // Custom OpenAI-compatible gateways (modelIds Pi never registered) work.
    const { resolveAndCache } = await import("../infra/config/index.js");
    const { model: m } = resolveAndCache({ provider: p, modelId, overrideId: modelId });
    this.piAgent.state.model = m as any;
    // Refresh API key env var so the new model's transport picks it up.
    resolveApiKey(p);
  }

  getThinkingLevel(): string {
    return String(this.piAgent.state.thinkingLevel ?? "");
  }

  setThinkingLevel(level: string): void {
    this.piAgent.state.thinkingLevel = level as any;
  }

  getSkillCount(): number {
    return this.skills.getAll().length;
  }

  getSkillsPrompt(): string {
    return this.skills.toPromptContext();
  }

  getSkillDrafts(): readonly SkillDraft[] {
    return this.skills.getAllDrafts();
  }

  promoteSkillDraft(name: string): boolean {
    return this.skills.promoteDraft(name) !== undefined;
  }

  archiveSkillDraft(name: string): boolean {
    const before = this.skills.getDraft(name);
    this.skills.archiveDraft(name);
    return before !== undefined;
  }

  async suggestStartup(): Promise<string> {
    const { StartupAdvisor } = await import("@phus/core/runtime/startup/advisor.js");
    const advisor = new StartupAdvisor();
    return advisor.suggestStartup(this.tape);
  }

  async reflect(sessionId: SessionId, task: string): Promise<import("@phus/runtime/core/runtime/evolution/types.js").Reflection> {
    return this.learner.reflect(sessionId, task);
  }

  getTapeTotalEntries(): number {
    return this.tape.stats().totalEntries;
  }

  // ─── Memory facade methods ───────────────────────────────────
  getAutonomyGate(): AutonomyGate {
    return this.autonomyGate;
  }

  getMemoryStore(): MemoryStore {
    return this.memoryStore;
  }

  getMemoryBytes(): number {
    return this.memoryStore.size();
  }

  getSessionCount(): number {
    return Object.keys(this.tape.stats().sessions).length;
  }

  hasMessages(): boolean {
    return this.piAgent.state.messages.length > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.piEventUnsubscribe?.();
    this.piEventUnsubscribe = undefined;
    if (!this.abortController.signal.aborted) this.abortController.abort();
    this.planRunner.abort();
    this.planEventHandlers.clear();
    this.compactEventHandlers.clear();
  }

  getMessageCount(): number {
    return this.piAgent.state.messages.length;
  }

  getTurnCount(): number {
    return this.piAgent.state.messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    ).length;
  }

  interrupt(): void {
    this.piAgent.abort();
    logger.info("turn.interrupted");
  }

  getMesh(): MeshLike {
    return this.mesh;
  }

  getPlanRunner(): PlanRunner | undefined {
    return this.planRunner;
  }

  getPlanStore(): PlanStore | undefined {
    return this.planStore;
  }

  async loadPluginsForReload(channels: ChannelAdapter[]): Promise<{
    skills: number;
    plugins: number;
    pluginStatus: Array<{ name: string; ok: boolean; path: string }>;
  }> {
    return this.reloadSkillsAndPlugins(channels);
  }

}

/** Multi-session facade: resolves envelopes and delegates to isolated runtimes. */
export class PhusAgent implements PhusAgentFacade {
  readonly tape: Tape;
  readonly sessionStorage?: SessionStorage;
  readonly sessionStore?: SessionStore;
  readonly skills: SkillRegistry;
  readonly memoryStore: MemoryStore;
  readonly autonomyGate: AutonomyGate;
  readonly repoIndex?: RepoFileIndex;
  readonly policy: readonly PolicyRule[];
  readonly profile: ProviderProfile;
  readonly mesh: MeshLike;
  readonly hooks: HookRegistry;
  readonly planStore: PlanStore;
  readonly extraChannels: ChannelAdapter[];
  readonly runtimeRegistry: SessionRuntimeRegistry<
    AgentEvent,
    PlanEvent,
    CompactEvent,
    ToolPermissionRequest,
    SessionRuntime
  >;

  private readonly initialSessionId: SessionId;
  private explicitSelection = false;
  private routedSelection = false;

  constructor(private readonly deps: PhusAgentDeps) {
    this.tape = deps.tape;
    this.sessionStorage = deps.sessionStorage;
    this.sessionStore = deps.sessionStore;
    this.skills = deps.skills;
    this.memoryStore = deps.memoryStore;
    this.autonomyGate = deps.autonomyGate;
    this.repoIndex = deps.repoIndex;
    this.policy = deps.policy;
    this.profile = deps.profile;
    this.mesh = deps.mesh;
    this.hooks = deps.hooks;
    this.planStore = deps.planStore ?? new PlanStore(":memory:");
    this.extraChannels = deps.channels ?? [];
    this.initialSessionId = deps.initialSessionId ?? asSessionId("tui:user");

    registerDefaultHooks(this.hooks, { tape: this.tape });
    this.runtimeRegistry = new SessionRuntimeRegistry(
      (sessionId) => this.createRuntime(sessionId),
      { maxRuntimes: deps.maxSessionRuntimes },
    );
    this.registerPlanHooks();
    this.reconcileInterruptedPlans();
    this.runtimeRegistry.setSelected(this.initialSessionId);
  }

  private createRuntime(sessionId: SessionId): SessionRuntime {
    if (
      sessionId !== this.initialSessionId
      && (this.deps.corePort || this.deps.planner || this.deps.executor || this.deps.planRunner)
    ) {
      throw new Error(
        "multi-session runtimes require factory-safe dependencies; legacy singleton overrides only support the initial session",
      );
    }
    this.sessionStore?.ensure(sessionId);
    const steeringInbox = sessionId === this.initialSessionId
      ? this.deps.steeringInbox
      : this.deps.steeringInboxFactory?.() ?? new PiSteeringInbox();
    return new SessionRuntime({
      ...this.deps,
      planStore: this.planStore,
      steeringInbox,
      corePort: sessionId === this.initialSessionId ? this.deps.corePort : undefined,
      planner: sessionId === this.initialSessionId ? this.deps.planner : undefined,
      executor: sessionId === this.initialSessionId ? this.deps.executor : undefined,
      planRunner: sessionId === this.initialSessionId ? this.deps.planRunner : undefined,
    }, {
      sessionId,
      steeringInbox,
      registerSharedHooks: false,
      reconcilePlans: false,
    });
  }

  private active(): SessionRuntime {
    return this.runtimeRegistry.getSelected()
      ?? this.runtimeRegistry.setSelected(this.initialSessionId);
  }

  async turn(envelope: Envelope, channel: ChannelAdapter): Promise<Turn> {
    let sessionId = envelope.sessionId;
    if (!sessionId && this.explicitSelection && (envelope.channel === "tui" || envelope.channel === "cli")) {
      sessionId = this.runtimeRegistry.getSelectedSessionId();
    }
    if (!sessionId) {
      const resolvedRaw = await this.hooks.execute<string>(
        "resolve_session",
        makeCtx({ envelope, state: {}, tape: this.tape, skills: this.skills }),
        "first_result",
      );
      sessionId = asSessionId(resolvedRaw ?? this.fallbackSession(envelope));
    }
    this.sessionStore?.ensure(sessionId);
    if (!this.routedSelection && !this.explicitSelection) {
      this.runtimeRegistry.setSelected(sessionId);
      this.routedSelection = true;
    }
    const routedEnvelope: Envelope = { ...envelope, sessionId };
    return this.runtimeRegistry.runExclusive(
      sessionId,
      (runtime) => runtime.turn(routedEnvelope, channel),
    );
  }

  getCurrentSessionId(): SessionId | undefined {
    return this.runtimeRegistry.getSelectedSessionId();
  }

  setNextSessionId(id: SessionId): void {
    this.sessionStore?.ensure(id);
    this.runtimeRegistry.setSelected(id);
    this.explicitSelection = true;
  }

  abort(): void { this.active().abort(); }
  interrupt(): void { this.active().interrupt(); }
  waitForIdle(): Promise<void> { return this.active().waitForIdle(); }
  steer(message: AgentMessage): void { this.active().steer(message); }
  followUp(message: AgentMessage): void { this.active().followUp(message); }
  setToolPermissionHandler(handler: (req: ToolPermissionRequest) => Promise<boolean>): void {
    this.runtimeRegistry.setToolPermissionHandler(handler);
  }
  reloadSkills(): Promise<void> { return this.active().reloadSkills(); }
  clearConversation(): Promise<void> { return this.active().clearConversation(); }
  compactCurrentSession(): Promise<string> { return this.active().compactCurrentSession(); }
  restoreCheckpoint(id: SessionId): Promise<void> {
    this.runtimeRegistry.setSelected(id);
    return this.active().restoreCheckpoint(id);
  }
  saveCheckpoint(id: SessionId): void { this.runtimeRegistry.getOrCreate(id).saveCheckpoint(id); }
  listCheckpoints(id: SessionId): CheckpointEntry[] {
    return this.runtimeRegistry.getOrCreate(id).listCheckpoints(id);
  }
  getDiagnostics(): AgentDiagnostics { return this.active().getDiagnostics(); }
  getHookReport() { return this.hooks.report(); }
  getAllSkills() { return this.skills.getAll(); }
  getSkill(name: string) { return this.skills.get(name); }
  getPolicy(): readonly PolicyRule[] { return this.policy; }
  getTapeStats() { return this.tape.stats(); }
  *replayTape(sessionId?: string): Generator<import("@phus/core/types/tape/index.js").TapeEntry> {
    yield* this.tape.replay(sessionId);
  }
  getTapeSummary(sessionId: SessionId | undefined, limit: number): string {
    return this.tape.summary((sessionId as string) ?? "default", limit);
  }
  getAutonomyGate(): AutonomyGate { return this.autonomyGate; }
  getMemoryStore(): MemoryStore { return this.memoryStore; }
  getMemoryBytes(): number { return this.memoryStore.size(); }
  reloadSkillsAndPlugins(channels: ChannelAdapter[]) { return this.active().reloadSkillsAndPlugins(channels); }
  subscribeToAgentEvents(handler: (event: AgentEvent) => void): () => void {
    return this.runtimeRegistry.subscribeToAgentEvents(handler);
  }
  subscribeToPlanEvents(handler: PlanEventHandler): () => void {
    return this.runtimeRegistry.subscribeToPlanEvents(handler);
  }
  subscribeToCompactEvents(handler: CompactEventHandler): () => void {
    return this.runtimeRegistry.subscribeToCompactEvents(handler);
  }
  getModelLabel(): string { return this.active().getModelLabel(); }
  getCurrentModel(): { provider: string; id: string } { return this.active().getCurrentModel(); }
  setModel(modelId: string, provider?: string): Promise<void> {
    return this.active().setModel(modelId, provider);
  }
  getThinkingLevel(): string { return this.active().getThinkingLevel(); }
  setThinkingLevel(level: string): void { this.active().setThinkingLevel(level); }
  getSkillCount(): number { return this.skills.getAll().length; }
  getSkillsPrompt(): string { return this.skills.toPromptContext(); }
  getSkillDrafts(): readonly SkillDraft[] { return this.active().getSkillDrafts(); }
  promoteSkillDraft(name: string): boolean { return this.active().promoteSkillDraft(name); }
  archiveSkillDraft(name: string): boolean { return this.active().archiveSkillDraft(name); }
  suggestStartup(): Promise<string> { return this.active().suggestStartup(); }
  reflect(sessionId: SessionId, task: string) {
    return this.runtimeRegistry.getOrCreate(sessionId).reflect(sessionId, task);
  }
  getTapeTotalEntries(): number { return this.tape.stats().totalEntries; }
  getSessionCount(): number {
    return this.sessionStore?.list({ includeArchived: true }).length
      ?? Object.keys(this.tape.stats().sessions).length;
  }
  getMessageCount(): number { return this.active().getMessageCount(); }
  getTurnCount(): number { return this.active().getTurnCount(); }
  getMesh(): MeshLike { return this.mesh; }
  getPlanRunner(): PlanRunner | undefined { return this.active().getPlanRunner(); }
  getPlanStore(): PlanStore | undefined { return this.planStore; }
  getInterruptedPlans(): Plan[] { return this.planStore.loadPaused(); }
  pauseActivePlan(): string | undefined { return this.active().pauseActivePlan(); }
  resumeActivePlan(): Promise<string | undefined> { return this.active().resumeActivePlan(); }
  cancelActivePlan(): string | undefined { return this.active().cancelActivePlan(); }
  retryStep(planId: string, stepId: string): boolean {
    const plan = this.planStore.load(planId);
    return plan
      ? this.runtimeRegistry.getOrCreate(plan.sessionId).retryStep(planId, stepId)
      : false;
  }
  notifySubagentStarted(planId: string, info: { sessionId: string; label: string; goal: string }): void {
    const plan = this.planStore.load(planId);
    (plan ? this.runtimeRegistry.getOrCreate(plan.sessionId) : this.active())
      .notifySubagentStarted(planId, info);
  }
  notifySubagentCompleted(planId: string, sessionId: string, status: "completed" | "failed"): void {
    const plan = this.planStore.load(planId);
    (plan ? this.runtimeRegistry.getOrCreate(plan.sessionId) : this.active())
      .notifySubagentCompleted(planId, sessionId, status);
  }
  loadPluginsForReload(channels: ChannelAdapter[]) { return this.active().loadPluginsForReload(channels); }

  runTurn(sessionId: SessionId, taskText: string, signal?: AbortSignal) {
    return this.runtimeRegistry.getOrCreate(sessionId).runTurn(sessionId, taskText, signal);
  }
  getAbortSignal(): AbortSignal { return this.active().getAbortSignal(); }
  getTools(): AgentTool[] { return this.active().getTools(); }
  getModel(): unknown { return this.active().getModel(); }
  getApiKey(provider: string): string | undefined { return this.active().getApiKey(provider); }
  getSystemPrompt(): string { return this.active().getSystemPrompt(); }
  getApiKeyEnv(): string | undefined { return this.active().getApiKeyEnv(); }
  spawnSubAgent(opts: { systemPrompt: string; tools: AgentTool[]; sessionId: SessionId }): Agent {
    return this.active().spawnSubAgent(opts);
  }

  emitPlanEvent(event: PlanEvent): void {
    const runtime = this.runtimeRegistry.get(asSessionId(event.sessionId));
    runtime?.emitPlanEvent(event);
  }

  disposeSessionRuntimes(): void {
    this.runtimeRegistry.disposeAll();
  }

  private fallbackSession(envelope: Envelope): string {
    return `${envelope.channel || "cli"}:${(envelope.metadata as any)?.chatId ?? envelope.from ?? "default"}`;
  }

  private registerPlanHooks(): void {
    const specs: Array<{ name: HookName; type: PlanEvent["type"] }> = [
      { name: "plan_step_started", type: "plan_step_started" },
      { name: "plan_step_completed", type: "plan_step_completed" },
      { name: "plan_step_failed", type: "plan_step_failed" },
      { name: "plan_completed", type: "plan_completed" },
    ];
    for (const spec of specs) {
      this.hooks.register(spec.name, async (ctx) => {
        const plan = ctx.extras?.plan as Plan | undefined;
        const step = ctx.extras?.step as Step | undefined;
        if (plan) {
          this.emitPlanEvent({
            type: spec.type,
            planId: plan.id,
            sessionId: plan.sessionId,
            goal: plan.goal,
            planStatus: plan.status,
            step,
            error: typeof ctx.extras?.error === "string" ? ctx.extras.error : undefined,
          });
        }
        return ctx;
      }, { mode: "broadcast", priority: -100 });
    }
  }

  private reconcileInterruptedPlans(): void {
    const startedAt = Date.now();
    for (const plan of this.planStore.loadInterrupted(startedAt)) {
      plan.status = "paused";
      plan.updatedAt = startedAt;
      this.planStore.save(plan);
    }
  }

  static async create(opts: import("./default-deps.js").DefaultDepsOptions = {}): Promise<import("./lifecycle.js").PhusAgentHandle> {
    const deps = (await import("./default-deps.js")).buildDefaultPhusAgentDeps({
      allowMissingKey: true,
      ...opts,
    });
    return (await import("./lifecycle.js")).createPhusAgent(deps);
  }
}

// Re-export the legacy type-only default exports that the rest of the
// codebase still consumes through `provider-mesh` and `steering`.
export { ProviderMesh, type EndpointSpec, type MeshPolicy };
export { PiSteeringInbox };
