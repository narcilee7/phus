// src/session/context-budget.ts
// Pure context-budget math + tier classification for auto-compaction.
//
// No I/O. No pi-ai / pi-agent-core imports — the core module must stay
// free of provider SDKs. Callers (the runtime side) build the snapshot
// from whatever live state they have and pass it in.
//
// The fix the previous `estimateTokens` was missing: the actual request
// sent to the LLM includes the system prompt, the tool-definition
// schemas, and the reserved output budget. Counting only message
// content made the 0.7 threshold decorative — the request was already
// past 100% by the time compact "fired".

/** A piece of text (system prompt, message content, etc.) — char/4 heuristic. */
export function estimateTextTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens from an array of messages. Accepts any shape that
 * has `.content: string | Array<{ text?: string } | string>` — the
 * core module stays type-loose so runtime can pass `AgentMessage[]`
 * without dragging the pi-ai dependency in.
 */
export function estimateMessagesTokens(messages: unknown[] | undefined): number {
  if (!messages || messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { content?: unknown };
    const content = msg.content;
    if (typeof content === "string") {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === "string") {
          chars += c.length;
        } else if (c && typeof c === "object") {
          const text = (c as { text?: unknown }).text;
          if (typeof text === "string") chars += text.length;
        }
      }
    }
    chars += 50; // JSON wrapping + role overhead per message
  }
  return Math.ceil(chars / 4);
}

/** Estimate tokens from tool definitions (TypeBox schemas serialized as JSON). */
export function estimateToolsTokens(tools: unknown[] | undefined): number {
  if (!tools || tools.length === 0) return 0;
  try {
    const json = JSON.stringify(tools);
    if (json.length === 0) return 0;
    return Math.ceil(json.length / 4);
  } catch {
    // Circular refs or non-serializable — fall back to zero.
    return 0;
  }
}

export type ContextTier = "ok" | "near_limit" | "compact";

export interface ContextSnapshot {
  contextWindow: number | undefined;
  maxOutputTokens: number;
  inputBudget: number;
  messageTokens: number;
  systemPromptTokens: number;
  toolTokens: number;
  reportedInput?: number;
  total: number;
  ratio: number;
  tier: ContextTier;
}

export interface ContextBudgetInputs {
  contextWindow?: number;
  maxOutputTokens?: number;
  systemPrompt?: string;
  tools?: unknown[];
  messages?: unknown[];
  reportedInput?: number;
}

export interface ContextBudgetConfig {
  /** Tier transitions to `near_limit` when ratio ≥ this. */
  warnFraction: number;
  /** Tier transitions to `compact` when ratio ≥ this. */
  maxContextFraction: number;
}

export interface BudgetLogger {
  warn: (event: string, payload?: Record<string, unknown>) => void;
}

export const NOOP_BUDGET_LOGGER: BudgetLogger = { warn: () => {} };

export const DEFAULT_BUDGET_CONFIG: ContextBudgetConfig = {
  warnFraction: 0.5,
  maxContextFraction: 0.6,
};

/** Build a snapshot. Pure — no I/O. The logger receives a one-shot
 *  warn when the provider's reported `maxOutputTokens` exceeds the
 *  context window (defensive clamp). */
export function buildSnapshot(
  inputs: ContextBudgetInputs,
  logger: BudgetLogger = NOOP_BUDGET_LOGGER,
): ContextSnapshot {
  const contextWindow = inputs.contextWindow;
  const maxOutputTokens = inputs.maxOutputTokens ?? 0;
  const systemPromptTokens = estimateTextTokens(inputs.systemPrompt);
  const toolTokens = estimateToolsTokens(inputs.tools);
  const messageTokens = estimateMessagesTokens(inputs.messages);
  const reportedInput = inputs.reportedInput;

  // Compute input budget. Defensive clamp when maxOutputTokens > contextWindow.
  let inputBudget: number;
  if (contextWindow && contextWindow > 0) {
    if (maxOutputTokens > contextWindow) {
      // Provider's reported max output is larger than its context window.
      // Defensive: clamp input budget to half the context window so we
      // never "budget" more than the model can actually read.
      inputBudget = Math.max(1, Math.floor(contextWindow / 2));
      logger.warn("context.max_output_exceeds_window", {
        contextWindow,
        reportedMaxOutput: maxOutputTokens,
        clampedInputBudget: inputBudget,
      });
    } else {
      inputBudget = Math.max(1, contextWindow - maxOutputTokens);
    }
  } else {
    inputBudget = 0;
  }

  // Prefer the API-reported input token count when available — it's
  // exact, the heuristic is not. The breakdown (message/system/tool)
  // is kept for diagnostics but not summed when reportedInput is set.
  const total = reportedInput ?? (systemPromptTokens + toolTokens + messageTokens);
  const ratio = inputBudget > 0 ? total / inputBudget : 0;

  const tier: ContextTier = (() => {
    if (!contextWindow || contextWindow <= 0) return "ok";
    if (ratio >= DEFAULT_BUDGET_CONFIG.maxContextFraction) return "compact";
    if (ratio >= DEFAULT_BUDGET_CONFIG.warnFraction) return "near_limit";
    return "ok";
  })();

  return {
    contextWindow,
    maxOutputTokens,
    inputBudget,
    messageTokens,
    systemPromptTokens,
    toolTokens,
    reportedInput,
    total,
    ratio,
    tier,
  };
}

/** Classify a snapshot's tier against a budget config. Exposed as a
 *  separate function so the caller can re-classify with a different
 *  threshold (e.g. after user tuning) without rebuilding the snapshot. */
export function classifyTier(
  snapshot: ContextSnapshot,
  cfg: ContextBudgetConfig = DEFAULT_BUDGET_CONFIG,
): ContextTier {
  if (!snapshot.contextWindow || snapshot.contextWindow <= 0) return "ok";
  if (snapshot.ratio >= cfg.maxContextFraction) return "compact";
  if (snapshot.ratio >= cfg.warnFraction) return "near_limit";
  return "ok";
}
