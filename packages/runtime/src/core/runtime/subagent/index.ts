// packages/runtime/src/core/runtime/subagent/index.ts
// Sub-agent: dispatches a self-contained task on a fresh, isolated
// Agent instance.
//
// v4: the sub-agent owns a sibling `Agent` (not the parent's). The
// sibling has its own `state.messages`, its own session id, and its
// own internal abort signal. The sub-agent's tool calls + tool
// results stay in the sibling's messages and never bleed into the
// parent's history. The parent's piAgent is untouched.
//
// The AbortSignal chain is:
//   PhusAgent.abort()         (parent-level)
//     └─ abortController.abort()
//          └─ abortSignal     (read by sub-agent.run)
//               ├─ agent.prompt(signal) — pi-agent-core hooks see this
//               └─ fetch(signal)      — transport layer
//   SubAgent.run timeout      (per-run wall clock)
//     └─ timeoutController.abort()
//          └─ mirror to deps.agent.abort() and re-fire the combined signal

import { asSessionId } from "@phus/core/types/brand.js";
import { type PlanPhase, type SubAgentOptions } from "../plan/types";
import { SubAgentAgentLike } from "./types";
import { loadConfig } from "../../../infra/config/index.js";
import { logger } from "../../../infra/logging.js";

export class SubAgentTimeoutError extends Error {
  override readonly name = "SubAgentTimeoutError";
}

const PHASE_GUIDANCE: Record<PlanPhase, string> = {
  inspect: "Inspect the relevant code, config, and tests before changing anything.",
  edit: "Make the smallest targeted code change that addresses the task.",
  test: "Run or update tests and report the concrete result.",
  repair: "Use the failure context to diagnose and fix the exact cause.",
};

export class SubAgent {
  constructor(private deps: { agent: SubAgentAgentLike }) {}

  private buildSubSessionId(parentSessionId: string) {
    return asSessionId(`${parentSessionId}:sub:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
  }

  async run(options: SubAgentOptions, externalSignal?: AbortSignal): Promise<unknown> {
    const parentSessionId = options.parentSessionId;
    const subSessionId = this.buildSubSessionId(parentSessionId);

    const taskText = this.buildTaskText(options);

    // Compose the system prompt: parent's base + skills + the
    // sub-agent's per-task framing. We do this here (not in the
    // agent) so the parent can keep its own system prompt intact.
    const systemPrompt =
      this.deps.agent.getSkillsPrompt();

    // Spawn the sub-agent's own Agent. `tools` here is the parent's
    // tool list — the sub-agent re-uses the parent's tool surface
    // (bash, file_read, file_write, meta-tools) without cloning
    // the definitions, which would balloon the per-step cost.
    // `state.messages` is fresh because the Agent constructor
    // initializes it to [].
    const sibling = this.deps.agent.spawnSubAgent({
      systemPrompt,
      tools: this.deps.agent.getTools(),
      sessionId: subSessionId,
    });

    // Build the per-run abort signal: composed from the parent's
    // runtime-level signal (Ctrl+C), the caller's external signal
    // (e.g. plan-level abort), and our own wall-clock timeout.
    // Any of the three firing aborts the combined signal.
    const timeoutMs = loadConfig().robustness.subagentTimeoutMs;
    const timeoutController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    timer = setTimeout(() => {
      this.deps.agent.abort?.();
      timeoutController.abort();
    }, timeoutMs);
    timer.unref?.();

    const combinedSignal = AbortSignal.any([
      this.deps.agent.getAbortSignal(),
      timeoutController.signal,
      ...(externalSignal ? [externalSignal] : []),
    ]);

    try {
      // Push the task into the sibling's message stream. We
      // pre-pend a system-side framing so the model knows it's
      // running as a sub-agent (not the parent).
      sibling.state.messages = [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: taskText }],
          timestamp: Date.now(),
        },
      ];
      sibling.sessionId = subSessionId;

      // Race the prompt against the timeout. A stuck `prompt`
      // (e.g. the LLM provider is hanging) is the symptom this
      // race guards against — without it, the sub-agent would
      // block until the parent's own watchdog fired.
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutController.signal.addEventListener(
          "abort",
          () => reject(new SubAgentTimeoutError(`sub-agent timed out after ${timeoutMs}ms`)),
          { once: true },
        );
      });

      // pi-agent-core's prompt() takes a message arg; the
      // continue() method resumes from the current messages
      // array. We already pushed the user message into
      // sibling.state.messages above, so continue() picks up
      // from there. The combined signal reaches pi-agent-core
      // via the agent's own .signal getter; if a timeout
      // fires, sibling.abort() is called by the timeout
      // callback.
      await Promise.race([sibling.continue(), timeoutPromise]);

      // Extract the last assistant text from the sibling's
      // PRIVATE messages — no parent pollution, no session bleed.
      const messages = sibling.state.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (!lastAssistant) return "";
      return lastAssistant.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("");
    } catch (err) {
      if (timeoutController.signal.aborted) {
        throw new SubAgentTimeoutError(`sub-agent timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      // The sibling Agent isn't disposed here — pi-agent-core
      // doesn't expose a clean teardown. Its `state.messages`
      // is still private, so leaving it alive doesn't leak
      // anything into the parent. On the next sub-agent.run,
      // `spawnSubAgent` builds a fresh Agent instance, so
      // messages never accumulate across runs.
    }
  }

  private buildTaskText(options: SubAgentOptions): string {
    const phase = options.phase ?? "edit";
    const parts = [
      `Phase: ${phase}`,
      PHASE_GUIDANCE[phase],
      `Task: ${options.task}`,
    ];

    if (options.context) {
      parts.push(`Context: ${options.context}`);
    }

    if (options.repairContext) {
      parts.push(`Repair context: ${options.repairContext}`);
    }

    return parts.join("\n\n");
  }
}

// quiet unused — logger is wired but we don't need a per-instance
// ref in the v1 sub-agent (errors propagate up through Promise
// rejection).
void logger;