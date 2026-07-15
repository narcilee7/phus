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
