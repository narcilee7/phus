// src/bridge/pi-agent.ts
// PhusAgent — wraps @mariozechner/pi-agent-core's Agent, runs the Bub hook chain:
//   resolve_session → load_state → build_prompt → [Pi agent loop]
//                                                      ├ before_tool_call → tool → after_tool_call
//                                                      └ on events: write to Tape
//   save_state → render_outbound → dispatch_outbound
//
// Skills + tape summary are injected via Agent's transformContext, which runs
// before every LLM call (matching Bub's system_prompt / build_tape_context hooks).

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
import { getModel, type Model } from "@mariozechner/pi-ai";
import type { Envelope, Outbound, Turn } from "../core/types.js";
import { HookRegistry, makeCtx, type HookContext } from "../core/hook.js";
import { Tape } from "../core/tape.js";
import { SkillRegistry } from "../core/skill.js";
import { createMetaTools } from "../core/meta.js";
import { createExternalTools } from "./tools.js";
import { defaultPolicy, evaluate, type PolicyRule } from "../core/policy.js";
import { logger } from "../core/logger.js";
import type { ChannelAdapter } from "../channels/base.js";

function resolveModel(): Model<any> {
  const spec = process.env.PHUS_MODEL ?? "anthropic/claude-sonnet-4-20250514";
  const [provider, modelId] = spec.split("/", 2);
  if (!provider || !modelId) {
    throw new Error(`Invalid PHUS_MODEL="${spec}". Expected "<provider>/<modelId>", e.g. "openai/gpt-4o".`);
  }
  return getModel(provider as any, modelId as any);
}

const SYSTEM_PROMPT_HEADER = `You are Phus (⛰️ 西西弗斯), a self-evolving agent.

Your essence is repetition with growth — every turn you push the stone up the mountain, and every turn you learn something new.

You can:
- Learn new skills via skill_write (body is a prompt guide, not code)
- Read existing skills via skill_read
- Delete skills via skill_delete
- Modify your startup behavior via startup_write (only takes effect on next gateway boot)
- Reflect on your past via self_reflect
- Check your statistics via tape_stats
- Run shell commands via bash
- Read/write files via file_read / file_write

You are not forced to reply. You are not forced to do anything. You decide what to do.
Keep responses concise. Use tools when they help.`;

export class PhusAgent {
  private piAgent: Agent;
  private hooks = new HookRegistry();
  private tape: Tape;
  private skills: SkillRegistry;
  private policy: PolicyRule[];
  private currentSessionId: string | undefined;
  private extraChannels: ChannelAdapter[] = [];

  constructor() {
    this.tape = new Tape();
    this.skills = new SkillRegistry();
    this.policy = defaultPolicy();

    const tools: AgentTool[] = [
      ...createMetaTools(this.skills, this.tape).map(toAgentTool),
      ...createExternalTools(),
    ];

    this.piAgent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT_HEADER,
        model: resolveModel(),
        tools,
        messages: [],
      },
      transformContext: async (messages) => this.injectContext(messages),
      beforeToolCall: async (ctx, signal) => this.beforeToolCall(ctx, signal),
      afterToolCall: async (ctx, signal) => this.afterToolCall(ctx, signal),
    });

    this.piAgent.subscribe((event) => this.handleEvent(event));
    this.registerDefaultHooks();

    // Load plugins: they may register additional hooks / channels / skills.
    // Deferred via dynamic import to keep the constructor synchronous.
    void this.loadPluginsAsync();
  }

  private async loadPluginsAsync(): Promise<void> {
    const { loadPlugins } = await import("../core/plugin.js");
    loadPlugins(this.hooks, this.extraChannels, {
      registerRuntime: () => {
        // Runtime-registered skills are not yet supported (SkillRegistry reads from disk
        // synchronously in toPromptContext). Future: add an in-memory override.
      },
    });
  }

  /** Run one inbound envelope through the Bub hook chain. */
  async turn(envelope: Envelope, channel: ChannelAdapter): Promise<Turn> {
    const startedAt = Date.now();

    // 1. resolve_session (firstresult)
    const baseCtx = makeCtx({ envelope, sessionId: "", state: {}, tape: this.tape, skills: this.skills });
    const sessionId = (await this.hooks.execute<string>(
      "resolve_session",
      baseCtx,
      "firstresult",
    )) ?? `cli:${envelope.from}`;

    this.currentSessionId = sessionId;
    this.piAgent.sessionId = sessionId;

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

    // 3. build_prompt — handled by Pi (via transformContext injecting skills+tape),
    //    but we run the hook chain so plugins can intercept/transform the user msg.
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
      "firstresult",
    );

    // 4. Pi agent loop runs LLM + tool calls (transformContext injects skills/tape per call)
    await this.piAgent.prompt(userMsg);

    // 5. Extract assistant text from final state
    const lastAssistant = [...this.piAgent.state.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const modelOutput = extractText(lastAssistant);

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

    // 8. save_state (broadcast)
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
      id: crypto.randomUUID(),
      ts: startedAt,
      sessionId,
      inbound: envelope,
      prompt: envelope.content,
      modelOutput,
      toolCalls: this.collectToolCalls(),
      outbound: finalOutbounds,
      durationMs: Date.now() - startedAt,
    };
    this.tape.append({ kind: "turn", turn });

    logger.info("turn.completed", {
      sessionId,
      durationMs: turn.durationMs,
      toolCallCount: turn.toolCalls.length,
      outboundCount: finalOutbounds.length,
    });

    return turn;
  }

  /** Inject skills + tape summary into the system prompt on every LLM call. */
  private async injectContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const skillsCtx = this.skills.toPromptContext();
    const tapeSummary = this.currentSessionId
      ? this.tape.summary(this.currentSessionId, 10)
      : "(no session yet)";
    const stats = this.tape.stats();

    const injected = `${SYSTEM_PROMPT_HEADER}

## Current skills
${skillsCtx}

## Recent memory (last 10 turns of this session)
${tapeSummary || "(empty)"}

## Tape statistics
Total entries across all sessions: ${stats.totalEntries}
Sessions: ${Object.entries(stats.sessions).map(([s, c]) => `${s}=${c}`).join(", ") || "(none)"}`;

    this.piAgent.state.systemPrompt = injected;
    return messages;
  }

  /** Write tool_call entries to Tape before the tool runs. */
  private async beforeToolCall(
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    if (!this.currentSessionId) return undefined;

    // Operator-equivalence policy check (Bub principle):
    // evaluate first; if blocked, return {block: true, reason} and skip execution.
    const decision = evaluate(this.policy, {
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

    logger.debug("tool.call", {
      sessionId: this.currentSessionId,
      tool: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
    });

    this.tape.append({
      kind: "tool_call",
      sessionId: this.currentSessionId,
      toolCallId: ctx.toolCall.id,
      name: ctx.toolCall.name,
      args: ctx.args,
      ts: Date.now(),
    });
    return undefined;
  }

  /** Write tool_result entries to Tape after the tool runs. */
  private async afterToolCall(
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> {
    if (!this.currentSessionId) return undefined;
    this.tape.append({
      kind: "tool_result",
      sessionId: this.currentSessionId,
      toolCallId: ctx.toolCall.id,
      result: ctx.result,
      isError: ctx.isError,
      ts: Date.now(),
    });
    return undefined;
  }

  /** Subscribe handler — captures errors and (optionally) streaming text. */
  private handleEvent(event: AgentEvent): void {
    if (event.type === "agent_end") {
      // No-op; turn() handles final persistence.
    }
  }

  /** Pull collected tool calls from the current Pi state. */
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

  /** Default hook implementations. Plugins can override by registering higher-priority ones. */
  private registerDefaultHooks(): void {
    this.hooks.register<string>(
      "resolve_session",
      async (ctx) => {
        const env = ctx.envelope;
        if (!env) return undefined as any;
        const channel = env.channel || "cli";
        const chatId = (env.metadata as any).chatId ?? env.from ?? "default";
        return `${channel}:${chatId}`;
      },
      { mode: "firstresult", priority: 0 },
    );

    this.hooks.register(
      "load_state",
      async (ctx) => {
        if (!ctx.sessionId) return ctx;
        const anchor = this.tape.loadAnchor(ctx.sessionId);
        if (anchor) {
          ctx.state.lastAnchor = { name: anchor.name, ts: anchor.ts };
        }
        return ctx;
      },
      { mode: "broadcast", priority: 0 },
    );
  }

  /** Expose internal handles for CLI/diagnostic commands. */
  get _internal() {
    return {
      hooks: this.hooks,
      tape: this.tape,
      skills: this.skills,
      piAgent: this.piAgent,
      policy: this.policy,
      channels: this.extraChannels,
    };
  }
}

/** Extract plain text from an assistant message's content blocks. */
function extractText(msg: AgentMessage | undefined): string {
  if (!msg || msg.role !== "assistant") return "";
  const content = (msg as any).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}

/** Convert a MetaTool into an AgentTool. */
function toAgentTool(meta: import("../core/types.js").MetaTool): AgentTool {
  return {
    name: meta.name,
    label: meta.name,
    description: meta.description,
    parameters: meta.parameters,
    execute: async (_toolCallId, params) => {
      try {
        const result = await meta.execute(params as Record<string, unknown>);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err: any) {
        // Throw — Pi will mark result as isError and feed message back to LLM.
        throw new Error(err?.message ?? String(err));
      }
    },
  };
}
