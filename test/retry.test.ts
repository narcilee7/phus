// test/retry.test.ts
import { describe, expect, it, vi } from "vitest";
import { withRetry, shouldRetry, computeDelay, parseRetryAfter, HttpError, DEFAULT_RETRY } from "../src/core/scheduler/retry/index.js";

describe("HttpError", () => {
  it("carries status + retry-after", () => {
    const e = new HttpError("bad", 429, 5000);
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(5000);
    expect(e.message).toBe("bad");
  });
});

describe("shouldRetry", () => {
  it("retries on 429", () => {
    expect(shouldRetry(new HttpError("rate", 429))).toBe(true);
  });
  it("retries on 503", () => {
    expect(shouldRetry(new HttpError("unavail", 503))).toBe(true);
  });
  it("does not retry on 400", () => {
    expect(shouldRetry(new HttpError("bad req", 400))).toBe(false);
  });
  it("does not retry on 401", () => {
    expect(shouldRetry(new HttpError("unauth", 401))).toBe(false);
  });
  it("does not retry on 404", () => {
    expect(shouldRetry(new HttpError("not found", 404))).toBe(false);
  });
  it("retries on unknown 5xx", () => {
    expect(shouldRetry(new HttpError("weird", 599))).toBe(true);
  });
  it("retries on network errors", () => {
    expect(shouldRetry(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(shouldRetry(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(true);
  });
  it("does not retry on non-network Error", () => {
    expect(shouldRetry(new Error("some bug"))).toBe(false);
  });
});

describe("computeDelay", () => {
  it("grows exponentially", () => {
    const cfg = { ...DEFAULT_RETRY, jitter: false };
    expect(computeDelay(1, cfg)).toBe(1000);
    expect(computeDelay(2, cfg)).toBe(2000);
    expect(computeDelay(3, cfg)).toBe(4000);
  });
  it("caps at maxDelayMs", () => {
    const cfg = { ...DEFAULT_RETRY, jitter: false, maxDelayMs: 5000 };
    expect(computeDelay(10, cfg)).toBe(5000);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds", () => {
    expect(parseRetryAfter("30", 9999)).toBe(30_000);
  });
  it("returns fallback for missing", () => {
    expect(parseRetryAfter(undefined, 5000)).toBe(5000);
  });
  it("returns fallback for unparseable", () => {
    expect(parseRetryAfter("garbage", 5000)).toBe(5000);
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { ...DEFAULT_RETRY, maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error then succeeds", async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 3) throw new HttpError("rate", 429);
      return "ok";
    });
    const result = await withRetry(fn, {
      ...DEFAULT_RETRY,
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError("nope", 404));
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY, maxAttempts: 3, initialDelayMs: 1, jitter: false }),
    ).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws last error after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError("rate", 429));
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY, maxAttempts: 3, initialDelayMs: 1, jitter: false }),
    ).rejects.toThrow("rate");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry callback for each retry", async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 3) throw new HttpError("rate", 429);
      return "ok";
    });
    const onRetry = vi.fn();
    await withRetry(fn, {
      ...DEFAULT_RETRY,
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 5,
      jitter: false,
    }, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After header", async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 2) throw new HttpError("rate", 429, 50);
      return "ok";
    });
    const start = Date.now();
    await withRetry(fn, {
      ...DEFAULT_RETRY,
      maxAttempts: 3,
      jitter: false,
    });
    const elapsed = Date.now() - start;
    // First attempt + 50ms retry-after
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
