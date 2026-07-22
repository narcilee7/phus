// packages/runtime/src/core/runtime/subagent/index.ts
// Sub-agent: dispatches a self-contained task to a fresh session.
//
// v2: instead of `steer()`-ing the parent Agent (which leaks the
// sub-task's tool calls + results back into the parent's message
// history, polluting the next turn), we now spin up the sub-agent
// as its own piAgent.prompt() turn on a fresh sub-session id. The
// sub-agent's messages are isolated to the sub-session and don't
// bleed back to the parent.

import { asSessionId } from "@phus/core/types/brand.js";
import { type PlanPhase, type SubAgentOptions } from "../plan/types";
import { SubAgentAgentLike } from "./types";
import { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractText } from "../../../bridge/text.js";
import { loadConfig } from "../../../infra/config/index.js";

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

  async run(options: SubAgentOptions): Promise<unknown> {
    const parentSessionId = options.parentSessionId;
    const subSessionId = this.buildSubSessionId(parentSessionId);
    const previousSessionId = this.deps.agent.getCurrentSessionId();

    const taskText = this.buildTaskText(options);

    // Wall-clock bound: a stuck sub-agent (hung request) must not
    // stall the whole plan. On timeout: abort the in-flight LLM
    // call via the agent-level abort, and throw; the Executor treats
    // it as one failed attempt.
    const timeoutMs = loadConfig().robustness.subagentTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Compose a per-run AbortSignal that fires on either:
    //   - the wall-clock timeout (so a stuck LLM call gets killed)
    //   - the agent-level abort (Ctrl+C, plan cancellation)
    // Either source aborts the signal; the LLM call resolves with
    // an AbortError and the race below settles to the timeout
    // (or the user abort, whichever fires first).
    const timeoutController = new AbortController();
    timer = setTimeout(() => {
      this.deps.agent.abort?.();
      timeoutController.abort();
    }, timeoutMs);
    timer.unref?.();
    try {
      // Switch to the sub-session. runTurn flips the active
      // sessionId back to the parent in its finally block, but we
      // also restore defensively here in case the call throws
      // before the finally runs.
      this.deps.agent.setNextSessionId(subSessionId);

      let finalMessages: AgentMessage[];
      try {
        // Race the LLM call against a timeout-driven reject. The
        // controller only fires if the timer pops OR the agent-level
        // abort lands (we mirror the agent's `abort()` to the same
        // controller in the timer's callback). Without the race, a
        // stuck `runTurn` that never resolves would block until
        // vitest's outer test timeout — exactly the symptom the
        // `subagent-timeout.test.ts` test guards against.
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutController.signal.addEventListener(
            "abort",
            () => reject(new SubAgentTimeoutError(`sub-agent timed out after ${timeoutMs}ms`)),
            { once: true },
          );
        });
        finalMessages = await Promise.race([
          this.deps.agent.runTurn(subSessionId, taskText, timeoutController.signal),
          timeoutPromise,
        ]);
      } catch (err) {
        // Map abort / timeout to a structured error so the
        // executor's retry/abort/replan logic can decide what to
        // do.
        if (timeoutController.signal.aborted) {
          throw new SubAgentTimeoutError(`sub-agent timed out after ${timeoutMs}ms`);
        }
        throw err;
      }
      const lastAssistant = [...finalMessages]
        .reverse()
        .find((m) => m.role === "assistant");
      return extractText(lastAssistant);
    } finally {
      if (timer) clearTimeout(timer);
      // Restore the parent's session id so the next plan step
      // (or the next user turn) goes back to the parent's
      // conversation. Without this, a sub-agent run would leave
      // the parent "stuck" in the sub-session.
      if (previousSessionId) {
        this.deps.agent.setNextSessionId(previousSessionId);
      }
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