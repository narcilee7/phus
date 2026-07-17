import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Verifier } from "@/core/runtime/verifier.js";
import type { Step } from "@/core/runtime/plan/types.js";

function makeStep(expectedOutput?: string): Step {
  return {
    id: "s1",
    index: 0,
    description: "test step",
    expectedOutput,
    status: "pending",
    retryCount: 0,
  };
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
});
