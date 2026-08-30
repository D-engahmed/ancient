// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Retry utility (Layer 12 §4 / Layer 21 §4).

import type { ErrorEnvelope, RetryBudget } from "@ANCIENT/contracts";

/** Compute the backoff delay for a given attempt (1-indexed), with optional jitter. */
export function nextDelay(attempt: number, budget: RetryBudget): number {
  const raw = Math.min(
    budget.maxDelayMs,
    budget.baseDelayMs * Math.pow(budget.backoffMultiplier, attempt),
  );
  return budget.jitter ? raw * (0.5 + Math.random() * 0.5) : raw;
}

/**
 * Retry an operation with a budget and a retry predicate.
 * Retries ONLY when `shouldRetry(err)` says so; a retry attempt that exhausts
 * `maxAttempts` throws the last ErrorEnvelope rather than giving up silently.
 * Never blindly retry irreversible side effects — the caller supplies the
 * predicate, which should respect `retryableAsIs` / `idempotent` (Layer 5).
 */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  budget: RetryBudget,
  shouldRetry: (err: ErrorEnvelope) => boolean,
): Promise<T> {
  let lastErr: ErrorEnvelope | undefined;
  for (let attempt = 1; attempt <= budget.maxAttempts; attempt++) {
    try {
      return await op(attempt);
    } catch (e) {
      lastErr = e as ErrorEnvelope;
      if (!shouldRetry(lastErr) || attempt === budget.maxAttempts) throw lastErr;
      await new Promise((r) => setTimeout(r, nextDelay(attempt, budget)));
    }
  }
  throw lastErr;
}