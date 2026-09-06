// A 429 (rate limit) is retryable - it resolves on its own within seconds,
// unlike an auth/validation failure. Also retries a 2xx response our own
// code still couldn't use (missing content, or content that failed to parse
// as JSON) - a model's reasoning can occasionally run long enough to exhaust
// the response before ever reaching the JSON answer, even at temperature 0.
const RATE_LIMIT_STATUS = 429;
const FALLBACK_RETRY_DELAY_MS = 12_000;
const MIN_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

type RetryableResult = {
  ok: boolean;
  status?: number;
  retryAfterMs?: number | null;
  blocked?: boolean;
};

function isRetryable(status: number | undefined): boolean {
  if (status === RATE_LIMIT_STATUS) return true;
  return status !== undefined && status >= 200 && status < 300;
}

function resolveDelayMs(retryAfterMs: number | null | undefined): number {
  if (retryAfterMs == null || Number.isNaN(retryAfterMs)) return FALLBACK_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, retryAfterMs));
}

export async function withRateLimitRetry<T extends RetryableResult>(call: () => Promise<T>): Promise<T> {
  const first = await call();
  if (first.ok || first.blocked || !isRetryable(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, resolveDelayMs(first.retryAfterMs)));
  return call();
}
