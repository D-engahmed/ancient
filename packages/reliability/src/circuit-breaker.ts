// Copyright (c) 2026 NXG AI Solutions. All rights reserved.
// Proprietary and confidential. Unauthorized copying or distribution prohibited.
//
// Circuit breaker (Layer 12 §9 / Layer 21 §4). Per-provider and
// per-capability-kind instances are the bulkhead that keeps one failing
// provider or capability from consuming all resources.

import type { CircuitBreakerConfig } from "@ANCIENT/contracts";

type State = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private state: State = "closed";
  private failures: number[] = [];
  private openedAt = 0;
  private trialsUsed = 0;

  constructor(private cfg: CircuitBreakerConfig) {}

  /** Whether a new request may proceed without tripping the breaker. */
  canProceed(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cfg.openDurationMs) {
        this.state = "half_open";
        this.trialsUsed = 0;
        return true;
      }
      return false;
    }
    // half_open: allow a bounded number of trial requests.
    if (this.trialsUsed < this.cfg.halfOpenTrialRequests) {
      this.trialsUsed++;
      return true;
    }
    return false;
  }

  /** Record a success — resets the window and closes from half-open. */
  onSuccess(): void {
    if (this.state === "half_open") this.state = "closed";
    this.failures = [];
  }

  /** Record a failure — opens the breaker past the threshold. */
  onFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.cfg.windowMs);
    this.failures.push(now);
    if (this.state === "half_open" || this.failures.length >= this.cfg.failureThreshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  /** Current state, for observability. */
  getState(): State {
    return this.state;
  }
}