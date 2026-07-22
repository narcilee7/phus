import { describe, expect, it } from "vitest";
import { Verifier } from "../src/core/runtime/verifier/index.js";
import type { Step } from "../src/core/runtime/plan/types.js";
import type { CoreMessage, CorePort } from "../src/bridge/core-port.js";

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

function extractText(messages: CoreMessage[]): string {
  return messages.map((m) => m.content).join("\n");
}

function makePort(response: string): CorePort {
  return { complete: async () => ({ text: response }) };
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
      port: makePort(JSON.stringify({ ok: true, confidence: 0.9, reason: "matches", action: "proceed" })),
    });
    const result = await verifier.verify(makeStep("expected"), "actual");
    expect(result.ok).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.action).toBe("proceed");
  });

  it("falls back to lightweight when model output is malformed", async () => {
    const verifier = new Verifier({ port: makePort("bad json") });
    const result = await verifier.verify(makeStep("expected"), "actual");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
  });

  it("falls back to lightweight when expectedOutput is empty", async () => {
    const verifier = new Verifier({
      port: makePort(JSON.stringify({ ok: false, action: "abort" })),
    });
    const result = await verifier.verify(makeStep(), "actual");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
  });

  it("includes phase and repair context in the verification prompt", async () => {
    let promptText = "";
    const verifier = new Verifier({
      port: {
        complete: async (messages) => {
          promptText = extractText(messages);
          return { text: JSON.stringify({ ok: true, confidence: 0.8, reason: "fine", action: "proceed" }) };
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
