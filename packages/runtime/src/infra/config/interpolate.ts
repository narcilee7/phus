// src/infra/config/interpolate.ts
// `${VAR}` / `${VAR:-default}` / `$VAR` substitution for parsed YAML trees.
//
// Runs AFTER yaml.parse, BEFORE destructuring into ResolvedConfig — so
// the cache stores fully-resolved values and downstream consumers see
// no `${...}` syntax.
//
// Semantics (mirrors `docker-compose` / `dotenv-expand`):
//   - ${VAR}                       → process.env[VAR] (warn + leave literal if unset)
//   - ${VAR:-default}              → process.env[VAR] || "default" (only when VAR is unset)
//   - $VAR                         → process.env[VAR] (matched as identifier only)
//   - $$ → $                       (escape)
//   - \$ → $                       (escape)
//
// Cycles (a → b → a) emit one `config.interpolate_cycle` warn and stop;
// the offending string is left literal so the file is still parseable.
//
// Pure function. No file I/O. Logger callback is injected so the
// loader can pass `logger.warn` once logging is initialized; before
// that, the warn function is a noop recorder (tests can inspect it).

const VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g;
const BARE_RE = /(?<![A-Za-z0-9_$])\$([A-Z_][A-Z0-9_]*)/g;

export interface InterpolateOptions {
  /** How to handle unset `${VAR}` (no `:-default` part). Default: "warn". */
  onUnset?: "warn" | "error" | "leave";
  /** Receives one warn event per distinct unset var. Defaults to noop. */
  warn?: (event: string, fields: Record<string, unknown>) => void;
  /** Track which vars we've already warned about (so we emit once per name). */
  warned?: Set<string>;
  /** Track variables currently being expanded (cycle detection). */
  inProgress?: Set<string>;
  /** Absolute path of the file being interpolated (for diagnostics). */
  source?: string;
}

const NOOP_WARN: (event: string, fields: Record<string, unknown>) => void =
  () => {};

const STRINGIFIED_PROVIDER_NAME = String.raw`[A-Z_][A-Z0-9_]*`;

/**
 * Walk any value (object / array / primitive) and interpolate env-var
 * references in every string leaf. Returns a new value; the input is
 * not mutated.
 */
export function interpolateEnv(value: unknown, opts: InterpolateOptions = {}): unknown {
  const onUnset = opts.onUnset ?? "warn";
  const warn = opts.warn ?? NOOP_WARN;
  const warned = opts.warned ?? new Set<string>();
  const inProgress = opts.inProgress ?? new Set<string>();

  return walk(value, { onUnset, warn, warned, inProgress, source: opts.source });
}

interface WalkContext {
  onUnset: NonNullable<InterpolateOptions["onUnset"]>;
  warn: NonNullable<InterpolateOptions["warn"]>;
  warned: NonNullable<InterpolateOptions["warned"]>;
  inProgress: NonNullable<InterpolateOptions["inProgress"]>;
  source: string | undefined;
}

function walk(value: unknown, ctx: WalkContext): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return interpolateString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => walk(v, ctx));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Only values are interpolated, not keys — matches docker-compose.
      out[k] = walk(v, ctx);
    }
    return out;
  }
  // Symbols, bigints, functions — pass through untouched.
  return value;
}

function interpolateString(input: string, ctx: WalkContext): string {
  let result = input;

  // Pass 1: ${VAR} and ${VAR:-default}
  result = result.replace(VAR_RE, (_match, name: string, fallback: string | undefined) => {
    if (ctx.inProgress.has(name)) {
      if (!ctx.warned.has(`cycle:${name}`)) {
        ctx.warned.add(`cycle:${name}`);
        ctx.warn("config.interpolate_cycle", { var: name, source: ctx.source });
      }
      return _match; // leave literal
    }
    const envValue = process.env[name];
    if (envValue !== undefined && envValue !== "") {
      return envValue;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    if (ctx.onUnset === "error") {
      throw new ConfigError(`config: unset env var "${name}" in ${ctx.source ?? "<config>"}`);
    }
    if (ctx.onUnset === "warn" && !ctx.warned.has(name)) {
      ctx.warned.add(name);
      ctx.warn("config.interpolate_unset", { var: name, source: ctx.source });
    }
    return _match; // leave literal in both 'leave' and 'warn' modes
  });

  // Pass 2: $VAR (bare, only matched when preceded by start-of-string or non-identifier)
  // We have to mark progress for bare vars too — same cycle tracking.
  result = result.replace(BARE_RE, (_match, name: string) => {
    if (ctx.inProgress.has(name)) {
      if (!ctx.warned.has(`cycle:${name}`)) {
        ctx.warned.add(`cycle:${name}`);
        ctx.warn("config.interpolate_cycle", { var: name, source: ctx.source });
      }
      return _match;
    }
    const envValue = process.env[name];
    if (envValue !== undefined && envValue !== "") {
      return envValue;
    }
    if (ctx.onUnset === "error") {
      throw new ConfigError(`config: unset env var "${name}" in ${ctx.source ?? "<config>"}`);
    }
    if (ctx.onUnset === "warn" && !ctx.warned.has(name)) {
      ctx.warned.add(name);
      ctx.warn("config.interpolate_unset", { var: name, source: ctx.source });
    }
    return _match;
  });

  // Pass 3: escapes ($$ → $, \$ → $). Apply AFTER substitution so a
  // user's literal "$$FOO" doesn't get misread as a variable.
  // We treat any remaining `$$` or `\$` as a literal escape for `$`.
  // Note: this is conservative — it does NOT re-expand after escape
  // removal. That matches docker-compose behavior.
  result = result.replace(/\$\$/g, "$").replace(/\\\$/g, "$");

  return result;
}

/** Thrown by interpolateEnv when `onUnset: "error"` and a `${VAR}` is missing. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * Collect every variable name referenced (with or without `:-default`).
 * Useful for diagnostics and for `phus config validate`.
 */
export function extractVarRefs(value: unknown): string[] {
  const found = new Set<string>();
  collect(value, found);
  return [...found].sort();
}

function collect(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    let m: RegExpExecArray | null;
    const re1 = new RegExp(VAR_RE.source, "g");
    while ((m = re1.exec(value)) !== null) out.add(m[1]!);
    const re2 = new RegExp(BARE_RE.source, "g");
    while ((m = re2.exec(value)) !== null) out.add(m[1]!);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collect(v, out);
  }
}

/** Identifier regex helper for tests. */
export const VAR_NAME_REGEX = STRINGIFIED_PROVIDER_NAME;