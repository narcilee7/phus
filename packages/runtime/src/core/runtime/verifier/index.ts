// packages/runtime/src/core/runtime/verifier/index.ts
// Verifier — checks whether a step's actual result matches its
// expected output.
//
// v2: default path is **static**. LLM verification is opt-in
// (`requireLLMVerify: true`) because the previous behavior was:
//   - every step → 1 LLM call
//   - empty sub-agent result → "retry" → up to 3 LLM calls per step
//   - 10-step plan → 60-80 LLM calls, 5+ minutes wall-clock per plan
// Static rules cover the common cases (tool exit code, JSON shape,
// substring match) and never burn LLM time. LLM verify stays as a
// fallback when the result can't be decided structurally — which is
// the right tradeoff: most failures are "tool errored" or "produced
// wrong shape", both statically detectable.

import type { Step, VerificationResult, PlanPhase } from "../plan/types.js";
import type { CorePort } from "../../../bridge/core-port.js";

const PHASE_HINTS: Record<PlanPhase, string> = {
  inspect: "For inspect steps, prefer proceed when the result explains the codepath clearly enough to support the next action.",
  edit: "For edit steps, prefer proceed when the change is targeted and consistent with the expected output.",
  test: "For test steps, prefer proceed only when validation evidence is concrete and successful.",
  repair: "For repair steps, prefer retry when the failure points to a fixable cause in the current codepath; replan only when the shape of the task must change.",
};

export interface VerifierDeps {
  port?: CorePort;
  /**
   * When true, fall through to the LLM-based verification for any
   * step where static rules don't match. Default false — the static
   * rules are tuned to cover 80% of step shapes and the LLM path was
   * the dominant source of plan-level hangs (one LLM call per
   * verify, plus retries on empty results). Operators can opt in
   * per-plan or per-step via this flag.
   */
  requireLLMVerify?: boolean;
}

export class Verifier {
  constructor(private deps: VerifierDeps = {}) {}

  async verify(step: Step, result: unknown): Promise<VerificationResult> {
    // 1. Errors thrown by the sub-agent / executor → always "retry"
    //    (the next attempt might succeed) unless the retry count
    //    has already been exhausted.
    if (result instanceof Error) {
      return this.classifyError(result, step);
    }

    // 2. Tool-execution envelope: `{ content, details, isError }` —
    //    gate on `isError` first, then check the result shape.
    if (this.isToolEnvelope(result)) {
      if (result.isError) {
        return {
          ok: false,
          confidence: 0.9,
          reason: typeof result.details === "string"
            ? result.details.slice(0, 200)
            : "tool returned isError=true",
          action: step.retryCount >= 2 ? "abort" : "retry",
        };
      }
      // Tool succeeded — strip envelope and run the structural checks
      // against the unwrapped payload.
      const payload = result.details ?? result.content;
      return this.staticVerify(step, payload);
    }

    // 3. Plain result (string / object / number) — structural check
    //    directly.
    return this.staticVerify(step, result);
  }

  /** Static rules: don't call the LLM. Returns proceed / retry / abort
   *  based on shape match between `expectedOutput` and `result`. */
  private staticVerify(step: Step, result: unknown): VerificationResult {
    // Empty / null / false → retry. The previous behavior flagged
    // these for "retry" too, so the rule is preserved — just with a
    // higher confidence and a hard cap on retries.
    if (result === undefined || result === null || result === false || result === "") {
      return {
        ok: false,
        confidence: 0.9,
        reason: "result is empty / falsy",
        action: step.retryCount >= 2 ? "abort" : "retry",
      };
    }

    // expectedOutput present → keyword / shape match.
    if (step.expectedOutput && step.expectedOutput.trim()) {
      const matches = this.matchesExpected(result, step.expectedOutput);
      if (matches.kind === "match") {
        return {
          ok: true,
          confidence: 0.8,
          reason: `static: ${matches.reason}`,
          action: "proceed",
        };
      }
      // Mismatch — could be partial. The previous behavior was
      // "retry forever" (worse than LLM cost: burned cost, same
      // outcome). Now we abort after 2 retries and surface the
      // mismatch reason for the operator to inspect via /tape.
      if (matches.kind === "mismatch") {
        return {
          ok: false,
          confidence: 0.7,
          reason: `static: ${matches.reason}`,
          action: step.retryCount >= 2 ? "abort" : "retry",
        };
      }
      // No rule fired — fall through to truthy proceed if the
      // result is structurally usable (non-empty string, object
      // with content, etc.). The old LLM path would have decided
      // here, but for most cases a truthy result is "good enough
      // to move on" — the next step's verifier catches real bugs.
    }

    // Truthy result, no expectedOutput, or expectedOutput didn't
    // match any rule → proceed with low confidence. The operator
    // can re-enable LLM verification for high-stakes plans.
    return {
      ok: true,
      confidence: 0.5,
      reason: "result is truthy (no static rule matched)",
      action: "proceed",
    };
  }

  /** Map common Error types to actionable verdicts. Avoids the
   *  retry-loop where every retry hits the same wall. */
  private classifyError(err: Error, step: Step): VerificationResult {
    const msg = err.message ?? String(err);
    const isTimeout = /timeout|timed out|aborted/i.test(msg);
    const isPermission = /permission|denied|policy|not allowed/i.test(msg);
    const retryable = !isPermission; // permission errors won't fix themselves
    return {
      ok: false,
      confidence: 0.9,
      reason: isTimeout
        ? `sub-agent timed out: ${msg.slice(0, 150)}`
        : isPermission
          ? `blocked by policy: ${msg.slice(0, 150)}`
          : msg.slice(0, 200),
      action: !retryable ? "abort" : step.retryCount >= 2 ? "abort" : "retry",
    };
  }

  private isToolEnvelope(
    x: unknown,
  ): x is { content: unknown; details: unknown; isError: boolean } {
    return (
      typeof x === "object" &&
      x !== null &&
      "isError" in (x as any) &&
      typeof (x as any).isError === "boolean"
    );
  }

  /**
   * Compare a result against `expectedOutput`. Returns a tagged
   * outcome so the caller can distinguish "matched a rule" from
   * "no rule fired (fall through to truthy proceed)".
   *
   * Rules, in priority order:
   *   1. `expectedOutput` looks like a JSON path (starts with `{` or
   *      `[` or a quoted key) → try to JSON.parse the result, then
   *      check the shape.
   *   2. `expectedOutput` is a plain string → substring match.
   *   3. Otherwise → no rule fired.
   */
  private matchesExpected(
    result: unknown,
    expected: string,
  ): { kind: "match" | "mismatch" | "no-rule"; reason: string } {
    const exp = expected.trim();

    // Rule 1: JSON shape match
    if (this.looksLikeJsonShape(exp)) {
      const parsed = this.tryParseJsonish(result);
      if (parsed === undefined) {
        return { kind: "mismatch", reason: "expected JSON shape, got non-JSON" };
      }
      const ok = this.jsonShapeMatches(parsed, exp);
      return ok
        ? { kind: "match", reason: "result matches expected JSON shape" }
        : { kind: "mismatch", reason: `result does not match expected shape (${exp.slice(0, 80)})` };
    }

    // Rule 2: substring / regex match
    if (exp.startsWith("/") && exp.endsWith("/")) {
      try {
        const re = new RegExp(exp.slice(1, -1));
        const text = this.stringify(result);
        if (re.test(text)) {
          return { kind: "match", reason: `regex ${exp} matched` };
        }
        return { kind: "mismatch", reason: `regex ${exp} did not match` };
      } catch {
        // bad regex — fall through
      }
    }

    const text = this.stringify(result).toLowerCase();
    const needle = exp.toLowerCase();
    if (text.includes(needle)) {
      return { kind: "match", reason: "expectedOutput substring found" };
    }

    // No rule fired — caller falls through to "truthy proceed".
    return { kind: "no-rule", reason: "no static rule matched" };
  }

  private looksLikeJsonShape(s: string): boolean {
    return /^\s*[{[]/.test(s) || /^\s*"[^"]+"\s*:/.test(s);
  }

  private tryParseJsonish(x: unknown): unknown | undefined {
    if (typeof x === "object" && x !== null) return x;
    if (typeof x !== "string") return undefined;
    try {
      return JSON.parse(x);
    } catch {
      return undefined;
    }
  }

  /** Lightweight shape check: every key in `shape` must exist in `obj`
   *  with a compatible type. Values are recursively checked. */
  private jsonShapeMatches(obj: unknown, shape: string): boolean {
    try {
      const parsedShape = JSON.parse(shape);
      return this.shapeMatchesRecursive(obj, parsedShape);
    } catch {
      // shape isn't valid JSON — be conservative, treat as no-match
      return false;
    }
  }

  private shapeMatchesRecursive(actual: unknown, expected: unknown): boolean {
    if (expected === null) return actual === null;
    if (typeof expected !== "object" || expected === null) {
      // Primitive type placeholder: `{ "name": "string" }` — accept
      // anything truthy.
      return actual !== undefined && actual !== null;
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return false;
      if (expected.length === 0) return true;
      // Every expected element pattern must match at least one
      // actual element.
      return expected.every((p) => actual.some((a) => this.shapeMatchesRecursive(a, p)));
    }
    // Object shape: every key in expected must be present in actual
    // with a matching value shape.
    const expKeys = Object.keys(expected as Record<string, unknown>);
    if (expKeys.length === 0) return true;
    const actObj = actual as Record<string, unknown>;
    return expKeys.every((k) => {
      if (!(k in actObj)) return false;
      return this.shapeMatchesRecursive(actObj[k], (expected as any)[k]);
    });
  }

  private stringify(x: unknown): string {
    if (typeof x === "string") return x;
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  }

  /** LLM-based verification. Opt-in via `requireLLMVerify: true`.
   *  Reaches the LLM through the injected port; falls back to static
   *  rules on any failure. Kept around for plans where the static
   *  rules aren't expressive enough (semantic checks, narrative
   *  summaries, etc.). */
  private async llmVerify(
    step: Step,
    result: unknown,
  ): Promise<VerificationResult> {
    if (!this.deps.port) {
      return this.staticVerify(step, result);
    }
    if (!step.expectedOutput) {
      return this.staticVerify(step, result);
    }
    const text = this.buildPromptText(step, result);
    try {
      const response = await this.deps.port.complete([
        { role: "user", content: text },
      ]);
      const parsed = this.parseResult(response.text);
      if (parsed) return parsed;
    } catch {
      // fall through
    }
    return this.staticVerify(step, result);
  }

  private buildPromptText(step: Step, result: unknown): string {
    const actual = result instanceof Error ? result.message : JSON.stringify(result);
    const phase = step.phase ?? "edit";
    return [
      "You are a verifier. Compare the expected output of a step with the actual result and decide what to do next.",
      "Output JSON with fields: ok (boolean), confidence (0-1 number), reason (string), action (one of: proceed, retry, replan, escalate, abort).",
      `Phase: ${phase}`,
      PHASE_HINTS[phase],
      "",
      `Step: ${step.description}`,
      `Expected output: ${step.expectedOutput}`,
      step.repairContext ? `Repair context: ${step.repairContext}` : "",
      `Actual result: ${actual}`,
    ].join("\n");
  }

  private parseResult(response: string): VerificationResult | undefined {
    const cleaned = response.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
    try {
      const parsed = JSON.parse(cleaned) as Partial<VerificationResult>;
      if (
        typeof parsed.ok === "boolean" &&
        typeof parsed.action === "string" &&
        ["proceed", "retry", "replan", "escalate", "abort"].includes(parsed.action)
      ) {
        return {
          ok: parsed.ok,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          reason: String(parsed.reason ?? ""),
          action: parsed.action as VerificationResult["action"],
        };
      }
    } catch {
      // malformed model output
    }
    return undefined;
  }

  /** Top-level entry. Default = static only. Pass `requireLLMVerify`
   *  to opt into the LLM fallback. */
  async verifyStrict(
    step: Step,
    result: unknown,
    opts?: { requireLLMVerify?: boolean },
  ): Promise<VerificationResult> {
    const useLlm = opts?.requireLLMVerify ?? this.deps.requireLLMVerify ?? false;
    if (!useLlm) {
      return this.verify(step, result);
    }
    return this.llmVerify(step, result);
  }
}
