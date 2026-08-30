// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Backpressure (Layer 12 §8): a bounded queue where a full queue returns
// `EDGE_OVERLOADED` with a `retryAfterMs`, never an unbounded hang. Distilled
// latch/semaphore semantics — one consumer runs a job at a time; concurrent
// callers wait up to `maxQueueDepth` slots.

import { makeError, type BackpressurePolicy, type ErrorEnvelope } from "@ANCIENT/contracts";

export interface BackpressureSpan {
  /** Job priority — higher runs first when the queue is full (shed_lowest_priority). */
  priority?: number;
}

export type BackpressureResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorEnvelope };

/**
 * Bounded serial queue. When more jobs than `maxQueueDepth` are already
 * waiting, the excess is rejected with an `EDGE_OVERLOADED` envelope carrying
 * a `retryAfterMs` hint (with `onQueueFull: 'reject_with_retry_after'`) or the
 * lowest-priority queued job is shed and rejected (with
 * `onQueueFull: 'shed_lowest_priority'`).
 */
export class BackpressureGate {
  private runningCount = 0;
  private waiters: {
    priority: number;
    run: () => Promise<unknown>;
    resolve: (r: BackpressureResult<unknown>) => void;
  }[] = [];

  constructor(private policy: BackpressurePolicy) {}

  /** The number of jobs currently waiting (excluding the running one). */
  waiting(): number {
    return this.waiters.length;
  }

  /** The number of jobs currently executing. */
  running(): number {
    return this.runningCount;
  }

  /** Submit a job and await its completion (or overload rejection). */
  run<T>(job: () => Promise<T>, span?: BackpressureSpan): Promise<BackpressureResult<T>> {
    return new Promise((resolve) => {
      const priority = span?.priority ?? 0;
      const wrapped: (typeof this.waiters)[number] = {
        priority,
        run: async () => job(),
        resolve: resolve as (r: BackpressureResult<unknown>) => void,
      };

      if (this.runningCount < 1) {
        this.pump(wrapped);
      } else if (this.waiters.length < this.policy.maxQueueDepth) {
        this.waiters.push(wrapped);
      } else {
        // Queue full — reject, or shed the lowest-priority waiter.
        if (this.policy.onQueueFull === "shed_lowest_priority") {
          const victim = this.lowestPriorityWaiter();
          if (victim) {
            this.waiters = this.waiters.filter((w) => w !== victim);
            victim.resolve({
              ok: false,
              error: this.overloadError(),
            });
            this.waiters.push(wrapped);
            return;
          }
        }
        wrapped.resolve({ ok: false, error: this.overloadError() });
      }
    });
  }

  private lowestPriorityWaiter(): (typeof this.waiters)[number] | undefined {
    if (this.waiters.length === 0) return undefined;
    return this.waiters.reduce((lowest, w) => (w.priority < lowest.priority ? w : lowest));
  }

  private overloadError(): ErrorEnvelope {
    return makeError({
      code: "EDGE_OVERLOADED",
      domain: "edge",
      message: "Backpressure queue full; retry later.",
      transient: true,
      retryableAsIs: true,
      partialEffect: "none",
      blastRadius: "tenant",
    });
  }

  private pump(next: (typeof this.waiters)[number]): void {
    this.runningCount++;
    next
      .run()
      .then((value) => next.resolve({ ok: true, value }))
      .catch((err) => next.resolve({ ok: false, error: err as ErrorEnvelope }))
      .finally(() => {
        this.runningCount--;
        const nextWaiter = this.waiters.shift();
        if (nextWaiter) this.pump(nextWaiter);
      });
  }
}