import { RetryConfig } from "@/core/scheduler/retry/types.js";

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [408, 425, 429, 500, 502, 503, 504],
  nonRetryableStatuses: [400, 401, 403, 404, 422],
};
