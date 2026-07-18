import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Verifier } from "@/core/runtime/verifier/index";
import type { Step } from "@/core/runtime/plan/types";

function makeStep(expectedOutput?: string): Step {
  return {
    id: "s1",
    index: 0,
    description: "test step",
    expectedOutput,
    phase: "edit",
    status: "pending",
    retryCount: 0,
  };
}

function extractText(messages: AgentMessage[]): string {
  return messages
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content
        .map((part) => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");
}

function makeModel(response: string) {
  return {
    prompt: async (_messages: AgentMessage[]): Promise<string> => response,
  };
}

describe("Verifier", () => {
  it("proceeds on truthy result when no model is available", async () => {
    const verifier = new Verifier();
    const result = await verifier.verify(makeStep("something"), "done");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
  });

  it("retries on falsy result when no model is available", async () => {
    const verifier = new Verifier();
    const result = await verifier.verify(makeStep("something"), "");
    expect(result.ok).toBe(false);
    expect(result.action).toBe("retry");
  });

  it("retries on Error result", async () => {
    const verifier = new Verifier();
    const result = await verifier.verify(makeStep("something"), new Error("boom"));
    expect(result.ok).toBe(false);
    expect(result.action).toBe("retry");
    expect(result.reason).toContain("boom");
  });

  it("uses model verdict when available", async () => {
    const verifier = new Verifier({
      model: makeModel(JSON.stringify({ ok: true, confidence: 0.9, reason: "matches", action: "proceed" })),
    });
    const result = await verifier.verify(makeStep("expected"), "actual");
    expect(result.ok).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.action).toBe("proceed");
  });

  it("falls back to lightweight when model output is malformed", async () => {
    const verifier = new Verifier({ model: makeModel("bad json") });
    const result = await verifier.verify(makeStep("expected"), "actual");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
  });

  it("falls back to lightweight when expectedOutput is empty", async () => {
    const verifier = new Verifier({
      model: makeModel(JSON.stringify({ ok: false, action: "abort" })),
    });
    const result = await verifier.verify(makeStep(), "actual");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
  });

  it("includes phase and repair context in the verification prompt", async () => {
    let promptText = "";
    const verifier = new Verifier({
      model: {
        prompt: async (messages: AgentMessage[]) => {
          promptText = extractText(messages);
          return JSON.stringify({ ok: true, confidence: 0.8, reason: "fine", action: "proceed" });
        },
      },
    });

    const step = makeStep("expected");
    step.phase = "repair";
    step.repairContext = "previous failure: tests broke";

    await verifier.verify(step, "actual");

    expect(promptText).toContain("Phase: repair");
    expect(promptText).toContain("previous failure: tests broke");
  });
});
