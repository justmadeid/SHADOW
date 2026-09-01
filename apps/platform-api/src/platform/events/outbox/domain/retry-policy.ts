export type RetryPolicy = {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};

export const DEFAULT_OUTBOX_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
};

export function computeRetryDelayMs(
  attemptCount: number,
  policy: RetryPolicy = DEFAULT_OUTBOX_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const attempt = Math.max(1, Math.floor(attemptCount));

  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.min(attempt - 1, 20),
  );

  const jitterSpan = exponential * policy.jitterRatio;
  const jitter = (random() * 2 - 1) * jitterSpan;

  return Math.max(0, Math.min(policy.maxDelayMs, Math.round(exponential + jitter)));
}
