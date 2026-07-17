import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { Executor } from "@/core/runtime/executor/index.js";
import { ReplanNeededError } from "@/core/runtime/executor/error.js";
import { Verifier } from "@/core/runtime/verifier/index.js";
import type { Plan, Step } from "@/core/runtime/plan/types.js";
import { asSessionId } from "@/types/brand.js";

function makePlan(): Plan {
  return {
    id: "plan-1",
    sessionId: asSessionId("session-1"),
    goal: "goal",
    status: "running",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeStep(): Step {
  return {
    id: "s1",
    index: 0,
    description: "do something",
    expectedOutput: "done",
    phase: "edit",
    status: "pending",
    retryCount: 0,
  };
}

function extractText(message: AgentMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ");
}

function makeMockAgent(resultText = "done") {
  const handlers: Array<(event: AgentEvent) => void> = [];
  const steered: string[] = [];
  return {
    steered,
    steer: (msg: AgentMessage) => {
      steered.push(extractText(msg));
      // Simulate a sub-agent run: emit an agent_end event with an assistant reply.
      handlers.forEach((h) =>
        h({
          type: "agent_end",
          messages: [
            msg,
            {
              role: "assistant",
              content: [{ type: "text", text: resultText }],
              timestamp: Date.now(),
            },
          ],
        } as AgentEvent),
      );
    },
    waitForIdle: async () => {},
    getCurrentSessionId: () => asSessionId("session-1"),
    setNextSessionId: () => {},
    subscribeToAgentEvents: (handler: (event: AgentEvent) => void) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
  };
}

describe("Executor", () => {
  it("executes a step via sub-agent and proceeds", async () => {
    const verifier = new Verifier();
    const executor = new Executor({ agent: makeMockAgent("done") as any, verifier });
    const step = makeStep();
    const { verification } = await executor.executeStep(step, makePlan());
    expect(step.status).toBe("completed");
    expect(verification.action).toBe("proceed");
  });

  it("retries with repair context after verification requests a retry", async () => {
    let calls = 0;
    const verifier = new Verifier({
      model: {
        prompt: async () => {
          calls++;
          return calls === 1
            ? JSON.stringify({ ok: false, confidence: 0.4, reason: "retry", action: "retry" })
            : JSON.stringify({ ok: true, confidence: 0.9, reason: "fixed", action: "proceed" });
        },
      },
    });
    const agent = makeMockAgent("fixed");
    const executor = new Executor({ agent: agent as any, verifier, maxRetries: 1 });
    const step = makeStep();

    await executor.executeStep(step, makePlan());

    expect(step.status).toBe("completed");
    expect(step.retryCount).toBe(1);
    expect(step.phase).toBe("repair");
    expect(agent.steered).toHaveLength(2);
    expect(agent.steered[1]).toContain("Phase: repair");
    expect(agent.steered[1]).toContain("Repair context:");
    expect(agent.steered[1]).toContain("retry");
  });

  it("retries a failing step up to maxRetries", async () => {
    let calls = 0;
    const verifier = new Verifier({
      model: {
        prompt: async () => {
          calls++;
          return JSON.stringify({ ok: calls >= 3, confidence: 0.5, reason: "retry", action: calls >= 3 ? "proceed" : "retry" });
        },
      },
    });
    const executor = new Executor({ agent: makeMockAgent("bad") as any, verifier, maxRetries: 2 });
    const step = makeStep();
    await executor.executeStep(step, makePlan());
    expect(step.status).toBe("completed");
    expect(step.retryCount).toBe(2);
  });

  it("marks step failed after max retries", async () => {
    const verifier = new Verifier({
      model: {
        prompt: async () => JSON.stringify({ ok: false, confidence: 0, reason: "no", action: "retry" }),
      },
    });
    const executor = new Executor({ agent: makeMockAgent("bad") as any, verifier, maxRetries: 1 });
    const step = makeStep();
    await executor.executeStep(step, makePlan());
    expect(step.status).toBe("failed");
    expect(step.retryCount).toBe(2);
  });

  it("calls a named tool when available", async () => {
    let called = false;
    const tools = new Map<string, (args: unknown) => Promise<unknown>>();
    tools.set("mock-tool", async () => {
      called = true;
      return "tool-result";
    });
    const verifier = new Verifier();
    const executor = new Executor({ agent: makeMockAgent() as any, verifier, tools });
    const step = makeStep();
    step.tool = "mock-tool";
    await executor.executeStep(step, makePlan());
    expect(called).toBe(true);
    expect(step.status).toBe("completed");
  });

  it("throws ReplanNeededError when verifier requests replan", async () => {
    const verifier = new Verifier({
      model: {
        prompt: async () => JSON.stringify({ ok: false, action: "replan", reason: "need replan" }),
      },
    });
    const executor = new Executor({ agent: makeMockAgent() as any, verifier });
    await expect(executor.executeStep(makeStep(), makePlan())).rejects.toBeInstanceOf(ReplanNeededError);
  });
});
