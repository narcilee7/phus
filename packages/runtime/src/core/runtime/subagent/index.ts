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

    // Wall-clock bound: pi-agent-core's loop is `while(true)` — a
    // stuck sub-agent (endless tool calls, hung request) must not
    // stall the whole plan. On timeout: abort the loop and throw;
    // the Executor treats it as one failed attempt.
    const timeoutMs = loadConfig().robustness.subagentTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Switch to the sub-session. setNextSessionId affects the
      // NEXT turn we kick off, so we have to call this BEFORE
      // prompt() — pairing it with steer() previously left a race
      // where the message went into the parent's session and the
      // session id was only used for the *following* turn.
      this.deps.agent.setNextSessionId(subSessionId);

      const idle = this.deps.agent.runTurn(subSessionId, taskText);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.deps.agent.abort?.();
          reject(new SubAgentTimeoutError(`sub-agent timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      });

      const finalMessages = await Promise.race([idle, timeout]);
      // Extract the last assistant text from the sub-agent's own
      // messages, not the parent's (which would include any
      // in-flight parent turn the user kicked off while the
      // sub-agent was running).
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