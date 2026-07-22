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

  it("uses static substring match when expectedOutput is present", async () => {
    const verifier = new Verifier();
    const result = await verifier.verify(makeStep("expected"), "actual contains expected substring");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("proceed");
    expect(result.reason).toMatch(/substring/);
  });

  it("aborts after retryCount >= 2 even on falsy result (no infinite loops)", async () => {
    const verifier = new Verifier();
    const step = makeStep("expected");
    step.retryCount = 2;
    const result = await verifier.verify(step, "");
    expect(result.action).toBe("abort");
  });

  it("opt-in LLM verify via requireLLMVerify flag (verifyStrict)", async () => {
    // With requireLLMVerify: true the port is consulted via
    // verifyStrict() and a {ok: false, action: "replan"} response
    // routes to "replan". The plain verify() entry stays on the
    // static path — that gate is what the executor's `wantLlm`
    // check sets per-call.
    const verifier = new Verifier({
      requireLLMVerify: true,
      port: makePort(JSON.stringify({ ok: false, confidence: 0.9, reason: "shape mismatch", action: "replan" })),
    });
    const result = await verifier.verifyStrict(makeStep("expected"), "actual");
    expect(result.ok).toBe(false);
    expect(result.action).toBe("replan");
  });

  it("LLM verify falls back to static when expectedOutput is empty", async () => {
    const verifier = new Verifier({
      requireLLMVerify: true,
      // The LLM response is irrelevant — empty expectedOutput means
      // the static path takes over regardless of the model verdict.
      port: makePort(JSON.stringify({ ok: false, confidence: 0.9, reason: "abort", action: "abort" })),
    });
    const result = await verifier.verify(makeStep(), "actual");
    expect(result.action).toBe("proceed");
  });

  it("LLM verify falls back to static when model output is malformed", async () => {
    const verifier = new Verifier({
      requireLLMVerify: true,
      port: makePort("not json at all"),
    });
    const result = await verifier.verify(makeStep("expected"), "actual contains expected");
    // Static fallback sees the substring match.
    expect(result.action).toBe("proceed");
  });

  it("LLM verify includes phase and repair context in the prompt (verifyStrict)", async () => {
    let promptText = "";
    const verifier = new Verifier({
      requireLLMVerify: true,
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

    await verifier.verifyStrict(step, "actual");

    expect(promptText).toContain("Phase: repair");
    expect(promptText).toContain("previous failure: tests broke");
  });
});
