// src/core/runtime/retry.ts
// Retry policy with exponential backoff + jitter.
//
// Used for:
//   - LLM API calls (delegate to Pi's built-in where possible; layer our own for
//     cases Pi doesn't handle)
//   - bash tool calls (network-dependent commands like curl, git, npm)
//
// NOT used for:
//   - Meta tools (skill_write etc.) — these are local and should be deterministic.
//   - User errors (bad input, missing file).

import { sleep } from "@/utils/promise.js";
import { logger } from "@/infra/logging.js";

// ─── Types ───────────────────────────────────────────────────────

/** Information passed to the on-retry callback. */
export interface RetryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
}

export interface RetryConfig {
  /** Max number of attempts (including the first). Default: 5. */
  maxAttempts: number;
  /** First backoff delay. Default: 1000 ms. */
  initialDelayMs: number;
  /** Cap on backoff. Default: 30000 ms. */
  maxDelayMs: number;
  /** Backoff multiplier between attempts. Default: 2. */
  backoffMultiplier: number;
  /** Add random jitter to delay (avoids thundering herd). Default: true. */
  jitter: boolean;
  /** HTTP statuses that should be retried. Default: [408, 425, 429, 500, 502, 503, 504]. */
  retryableStatuses: number[];
  /** HTTP statuses that should NOT be retried. Default: [400, 401, 403, 404, 422]. */
  nonRetryableStatuses: number[];
  /** Optional callback before each retry. */
  onRetry?: (info: RetryAttemptInfo) => void;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [408, 425, 429, 500, 502, 503, 504],
  nonRetryableStatuses: [400, 401, 403, 404, 422],
};

/** Custom error that carries an HTTP status code (or a code we can decide is retryable). */
export class HttpError extends Error {
  constructor(message: string, public status: number, public retryAfterMs?: number) {
    super(message);
    this.name = "HttpError";
  }
}

/** Decide whether an error should be retried. */
export function shouldRetry(err: unknown, cfg: RetryConfig = DEFAULT_RETRY): boolean {
  if (err instanceof HttpError) {
    if (cfg.nonRetryableStatuses.includes(err.status)) return false;
    if (cfg.retryableStatuses.includes(err.status)) return true;
    // Unknown status — be conservative and retry (5xx-ish behavior).
    return err.status >= 500;
  }
  // Network-level errors: retry.
  if (err instanceof Error) {
    const code = (err as any).code as string | undefined;
    const retryableCodes = new Set([
      "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
      "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
      "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
    ]);
    if (code && retryableCodes.has(code)) return true;
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("socket hang up") || msg.includes("fetch failed")) {
      return true;
    }
  }
  return false;
}

/** Compute the delay for the next attempt. */
export function computeDelay(attempt: number, cfg: RetryConfig): number {
  const exp = cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt - 1);
  const capped = Math.min(exp, cfg.maxDelayMs);
  if (!cfg.jitter) return capped;
  // Full jitter: random in [0, capped]. Half jitter would be [capped/2, capped].
  return Math.floor(Math.random() * capped);
}

/** Extract Retry-After header value (seconds or HTTP-date) into ms. */
export function parseRetryAfter(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  // Numeric: seconds
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  // HTTP-date
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return fallback;
}

/** Detect retry-after on an HttpError-like error. */
export function getRetryAfter(err: unknown): number | undefined {
  if (err instanceof HttpError) return err.retryAfterMs;
  // Some libs attach headers; we don't assume structure, just return undefined.
  return undefined;
}

/**
 * Execute `fn` with retry policy.
 *
 * @throws The last error if all attempts fail, or immediately if the error is non-retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  cfg: RetryConfig = DEFAULT_RETRY,
  onRetry?: (info: RetryAttemptInfo) => void,
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!shouldRetry(err, cfg)) {
        logger.debug("retry.skip_non_retryable", {
          attempt,
          error: lastErr.message,
        });
        throw lastErr;
      }
      if (attempt >= cfg.maxAttempts) {
        logger.warn("retry.exhausted", {
          attempt,
          maxAttempts: cfg.maxAttempts,
          error: lastErr.message,
        });
        throw lastErr;
      }
      const fallbackDelay = computeDelay(attempt, cfg);
      const retryAfter = getRetryAfter(err);
      const delayMs = retryAfter ?? fallbackDelay;
      const info: RetryAttemptInfo = { attempt, maxAttempts: cfg.maxAttempts, delayMs, error: lastErr };
      cfg.onRetry?.(info);
      onRetry?.(info);
      logger.info("retry.scheduled", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        error: lastErr.message,
      });
      await sleep(delayMs);
    }
  }
  // Unreachable, but TS likes exhaustive returns.
  throw lastErr ?? new Error("retry: exhausted");
}

/** Convenience: wrap a fetch-style call with retry. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  cfg: RetryConfig = DEFAULT_RETRY,
): Promise<Response> {
  return withRetry(async () => {
    const res = await fetch(url, init);
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") ?? undefined;
      throw new HttpError(
        `${init.method ?? "GET"} ${url} → ${res.status}`,
        res.status,
        retryAfter ? parseRetryAfter(retryAfter, 0) : undefined,
      );
    }
    return res;
  }, cfg);
}