// src/infra/config/validate.ts
// Load-time validation + cached model resolution.
//
// Two failure modes the rest of the codebase used to hit silently:
//
//   1. `getModel("foo", "bar")` returns `undefined` for unknown
//      (provider, modelId) combos — Pi doesn't throw. The old code
//      did `{ ...undefined, ...overrides }` and produced a half-
//      broken Model object missing cost, contextWindow, transport.
//
//   2. Custom OpenAI-compatible gateway endpoints (Volcano Ark,
//      Azure, vLLM) use modelIds Pi never registered (e.g.
//      `ep-20241120-abc123`). These need to *succeed* at load time
//      with a clear "inRegistry: false" marker, not fail.
//
// This module distinguishes (1) — invalid, fail loudly — from (2) —
// valid gateway override, warn but proceed. All 4 call sites in
// profile.ts / model-builder.ts / pi-agent.ts funnel through
// `resolveAndCache()` so the cache + warning happen once.

import { getModel, type Model } from "@mariozechner/pi-ai";

/** Result of resolving a (provider, modelId) tuple. */
export interface ModelResolution {
  /** The Pi Model object to pass downstream. */
  model: Model<any>;
  /** True iff the (provider, modelId) combo was in Pi's registry. */
  inRegistry: boolean;
}

interface CacheKey {
  provider: string;
  modelId: string;
  baseUrl?: string;
  overrideId?: string;
}

const _cache = new Map<string, ModelResolution>();

function keyOf(k: CacheKey): string {
  return `${k.provider}|${k.modelId}|${k.baseUrl ?? ""}|${k.overrideId ?? ""}`;
}

/**
 * Resolve a (provider, modelId) pair to a Pi Model. Falls back to a
 * synthesized Model for custom OpenAI-compatible gateways (e.g.
 * Volcano Ark ep-xxx endpoints). Cached per (provider, modelId,
 * baseUrl, overrideId) tuple.
 *
 * **Never throws for unknown combos.** Returns `inRegistry: false`
 * so the caller can emit a warn. Callers MUST check `inRegistry`
 * before assuming the model has valid `cost` / `contextWindow`.
 */
export function resolveAndCache(input: CacheKey): ModelResolution {
  const k = keyOf(input);
  const hit = _cache.get(k);
  if (hit) return hit;

  const base = getModel(input.provider as any, input.modelId as any);
  let inRegistry = true;
  let modelBase: Model<any>;

  if (base) {
    modelBase = base;
  } else {
    // Pi doesn't know this combo. Synthesize a minimal Model object
    // so downstream code can still spread `{...base, ...overrides}`.
    modelBase = synthesizeUnknown(input.provider, input.modelId);
    inRegistry = false;
  }

  const overrides: Partial<Model<any>> = {};
  if (input.baseUrl) overrides.baseUrl = input.baseUrl;
  if (input.overrideId) overrides.id = input.overrideId;

  const result: ModelResolution = {
    model: Object.keys(overrides).length > 0 ? { ...modelBase, ...overrides } : modelBase,
    inRegistry,
  };
  _cache.set(k, result);
  return result;
}

/** Drop the cache. Tests call this between cases. */
export function resetModelCache(): void {
  _cache.clear();
}

/** Internal — for diagnostics. Returns the number of cached entries. */
export function _modelCacheSize(): number {
  return _cache.size;
}

/**
 * Minimal Model stub for (provider, modelId) combos Pi doesn't know
 * about. Cost / contextWindow / headers / apiKey default to safe
 * fallbacks. Real cost tracking happens via costPerMillion on the
 * mesh entry in YAML.
 */
function synthesizeUnknown(provider: string, modelId: string): Model<any> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",   // most common OpenAI-compatible gateway shape
    provider,
    baseUrl: "https://api.example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  } as Model<any>;
}

// ─── Structural validation ─────────────────────────────────────────

/**
 * Validate a profile `model` string is `<provider>/<modelId>` shape.
 * Returns the parsed pair on success, or an error message on failure.
 */
export function validateModelString(
  raw: unknown,
  context: { profileName?: string; section?: string } = {},
): { provider: string; modelId: string } | string {
  const where = context.profileName
    ? `profile "${context.profileName}"${context.section ? ` (${context.section})` : ""}`
    : context.section ?? "model";
  if (typeof raw !== "string") {
    return `${where}: model must be a string, got ${typeof raw}`;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return `${where}: model is empty`;
  }
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return `${where}: model "${raw}" must be in the form "<provider>/<modelId>" (e.g. "anthropic/claude-sonnet-4-20250514")`;
  }
  const provider = trimmed.slice(0, slash);
  const modelId = trimmed.slice(slash + 1);
  if (modelId.includes("/")) {
    return `${where}: model "${raw}" has more than one "/" — did you mean to put the modelId in the model's own field?`;
  }
  return { provider, modelId };
}

/**
 * Validate a mesh entry's required fields. Returns ok / error message.
 */
export function validateMeshEntry(
  raw: unknown,
  index: number,
  context: { profileName?: string } = {},
): { provider: string; modelId: string } | string {
  const where = `mesh[${index}] of profile "${context.profileName ?? "?"}"`;
  if (!raw || typeof raw !== "object") {
    return `${where}: must be an object with provider + modelId`;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.provider !== "string" || r.provider.length === 0) {
    return `${where}: missing or invalid "provider" field`;
  }
  if (typeof r.modelId !== "string" || r.modelId.length === 0) {
    return `${where}: missing or invalid "modelId" field`;
  }
  return { provider: r.provider, modelId: r.modelId };
}

/**
 * Heuristic check for a `apiKeyEnv` value that looks like a literal
 * secret instead of an env-var name. Catches the common mistake of
 * pasting the key directly into YAML.
 *
 * Returns the warning string if it looks like a secret, or null.
 */
export function looksLikeSecret(value: string | undefined): string | null {
  if (!value) return null;
  // Order matters: check the most specific prefixes FIRST so they
  // win over the generic `sk-` / `AIza` / `hf_` rules below.
  if (value.startsWith("sk-ant-")) return "starts with 'sk-ant-' (Anthropic pattern)";
  if (value.startsWith("sk-or-")) return "starts with 'sk-or-' (OpenRouter pattern)";
  if (value.startsWith("gsk_")) return "starts with 'gsk_' (Groq pattern)";
  if (value.startsWith("xai-")) return "starts with 'xai-' (xAI pattern)";
  if (/^gh[pousr]_[A-Za-z0-9]{20,}/.test(value)) return "starts with 'gh*_' (GitHub pattern)";
  // Generics last — they match the specific ones above too if checked first.
  if (/^sk-[A-Za-z0-9_-]{8,}/.test(value)) return "starts with 'sk-' (OpenAI / Anthropic pattern)";
  if (/^AIza[A-Za-z0-9_-]{20,}/.test(value)) return "starts with 'AIza' (Google pattern)";
  if (/^hf_[A-Za-z0-9]{20,}/.test(value)) return "starts with 'hf_' (HuggingFace pattern)";
  // Anything with whitespace inside a supposed env-var name is wrong.
  if (/\s/.test(value)) return "contains whitespace";
  // All-lowercase + underscores is the env-var shape; anything else
  // (mixed case, dots, etc.) is suspicious for a *name*.
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return "is not in UPPER_SNAKE_CASE env-var form";
  return null;
}